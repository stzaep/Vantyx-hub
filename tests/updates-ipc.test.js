'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { registerUpdatesIpc } = require('../src/main/updates-ipc');
const { createUpdateService } = require('../src/core/updater');
const { createSettings } = require('../src/core/settings');
const { tmp, rmrf } = require('./helpers');

class FakeUpdater extends EventEmitter {
    constructor() { super(); this.calls = []; }
    async checkForUpdates() { this.calls.push('check'); this.emit('update-available', { version: '0.2.0', releaseNotes: 'n' }); return {}; }
    async downloadUpdate() { this.calls.push('download'); this.emit('update-downloaded', {}); }
    quitAndInstall(a, b) { this.calls.push(['quit', a, b]); }
}

function setup(root, over) {
    const handlers = new Map();
    const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
    const webContents = { sent: [], send(ch, payload) { this.sent.push([ch, payload]); } };
    const win = { webContents, isDestroyed: () => false };
    const updater = new FakeUpdater();
    const updates = createUpdateService({ autoUpdater: updater, currentVersion: '0.1.0' });
    const settings = createSettings({ dir: root });
    registerUpdatesIpc({ ipcMain, updates, settings, getWindow: () => win });
    const call = (ch, ...args) => handlers.get(ch)({ sender: webContents }, ...args);
    return { handlers, call, win, webContents, updater, updates, settings };
}

test('exactly the expected IPC channels are registered', () => {
    const root = tmp();
    try {
        const { handlers } = setup(root);
        assert.deepStrictEqual([...handlers.keys()].sort(),
            ['settings:get', 'settings:set', 'updates:check', 'updates:download', 'updates:get-state', 'updates:install']);
    } finally { rmrf(root); }
});

test('only the Hub window may call the channels', async () => {
    const root = tmp();
    try {
        const { handlers, updater } = setup(root);
        for (const ch of handlers.keys()) {
            const res = await handlers.get(ch)({ sender: { other: true } });
            assert.strictEqual(res.ok, false, ch);
            assert.strictEqual(res.error.code, 'BAD_REQUEST');
            assert.strictEqual((await handlers.get(ch)(undefined)).ok, false);
        }
        assert.deepStrictEqual(updater.calls, []);
    } finally { rmrf(root); }
});

test('check -> download -> install (confirmed) works through IPC and pushes state to the window', async () => {
    const root = tmp();
    try {
        const { call, webContents, updater } = setup(root);
        assert.strictEqual((await call('updates:get-state')).data.status, 'idle');
        assert.strictEqual((await call('updates:check')).data.status, 'available');
        assert.strictEqual((await call('updates:download')).data.status, 'downloaded');
        assert.ok(webContents.sent.length >= 3 && webContents.sent.every(s => s[0] === 'updates:state'));
        assert.deepStrictEqual(webContents.sent.map(s => s[1].status).slice(-1), ['downloaded']);
        const res = await call('updates:install', { confirmed: true });
        assert.strictEqual(res.ok, true);
        assert.deepStrictEqual(updater.calls.filter(c => Array.isArray(c)), [['quit', true, true]]);
    } finally { rmrf(root); }
});

test('install is refused without a literal { confirmed: true } or before the download', async () => {
    const root = tmp();
    try {
        const { call, updater } = setup(root);
        await call('updates:check'); await call('updates:download');
        for (const arg of [undefined, null, 'yes', 1, true, [], {}, { confirmed: 'true' }, { confirmed: false }]) {
            const r = await call('updates:install', arg);
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.error.code, 'UPDATE_NOT_CONFIRMED');
        }
        assert.ok(!updater.calls.some(c => Array.isArray(c)));

        const fresh = setup(tmp());
        const r = await fresh.call('updates:install', { confirmed: true });
        assert.strictEqual(r.error.code, 'UPDATE_NOT_READY');
        rmrf(path.dirname(path.join(fresh.settings.file)));
    } finally { rmrf(root); }
});

test('download without an available update is refused', async () => {
    const root = tmp();
    try {
        const { call, updater } = setup(root);
        const r = await call('updates:download');
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error.code, 'UPDATE_NOT_AVAILABLE');
        assert.deepStrictEqual(updater.calls, []);
    } finally { rmrf(root); }
});

test('settings:set validates keys and types; settings:get returns the saved values', async () => {
    const root = tmp();
    try {
        const { call } = setup(root);
        assert.deepStrictEqual((await call('settings:get')).data, { autoCheckUpdates: true });
        for (const bad of [undefined, null, [], 'x', {}, { evil: 1 }, { autoCheckUpdates: 'no' }, { autoCheckUpdates: false, extra: 1 }, { constructor: 1 }]) {
            const r = await call('settings:set', bad);
            assert.strictEqual(r.ok, false, JSON.stringify(bad));
            assert.strictEqual(r.error.code, 'BAD_REQUEST');
        }
        assert.strictEqual((await call('settings:get')).data.autoCheckUpdates, true);
        assert.deepStrictEqual((await call('settings:set', { autoCheckUpdates: false })).data, { autoCheckUpdates: false });
        assert.strictEqual((await call('settings:get')).data.autoCheckUpdates, false);
    } finally { rmrf(root); }
});

test('preload exposes only the update/settings API and never leaks ipcRenderer', async () => {
    const exposed = {}; const invoked = []; const listeners = new Map();
    const fakeElectron = {
        contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } },
        ipcRenderer: {
            invoke: async (...a) => { invoked.push(a); return { ok: true, data: null }; },
            on: (ch, fn) => listeners.set(ch, fn),
            removeListener: (ch, fn) => { if (listeners.get(ch) === fn) listeners.delete(ch); }
        }
    };
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
    vm.runInNewContext(src, { require: m => { assert.strictEqual(m, 'electron'); return fakeElectron; } });

    assert.deepStrictEqual(Object.keys(exposed).sort(), ['hub', 'settings', 'updates']);
    assert.deepStrictEqual(Object.keys(exposed.updates).sort(), ['check', 'download', 'getState', 'installAndRestart', 'onState']);
    assert.deepStrictEqual(Object.keys(exposed.settings).sort(), ['get', 'set']);

    await exposed.updates.installAndRestart('ignored', 'args');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(invoked[0])), ['updates:install', { confirmed: true }]);  // JSON: objects come from another vm realm
    await exposed.updates.check(); await exposed.settings.set({ autoCheckUpdates: false });
    assert.deepStrictEqual(invoked.slice(1).map(a => a[0]), ['updates:check', 'settings:set']);

    // listener receives only the state, never the IPC event object; unsubscribe works
    const got = []; const off = exposed.updates.onState(s => got.push(s));
    listeners.get('updates:state')({ sender: 'secret' }, { status: 'idle' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), [{ status: 'idle' }]);
    off(); assert.strictEqual(listeners.size, 0);
    assert.doesNotThrow(() => exposed.updates.onState('not a function')());
});
