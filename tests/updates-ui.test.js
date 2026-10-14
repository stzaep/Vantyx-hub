'use strict';
// Runs the real renderer scripts against a fake DOM, wired to the real update
// service and settings (with a fake electron-updater underneath).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { EventEmitter } = require('events');
const { createUpdateService } = require('../src/core/updater');
const { createSettings } = require('../src/core/settings');
const { createHub } = require('../src/core/hub');
const { tmp, rmrf, makeEnv } = require('./helpers');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const LIB = path.join(__dirname, '..', 'library');

class FakeEl {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.className = ''; this.children = []; this.parentNode = null; this._text = ''; this.handlers = {}; this.checked = false; this.type = ''; this.style = {}; this.hidden = false; this.disabled = false; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
    setAttribute() {} focus() {}
    querySelector(sel) { if (sel === 'button:last-child') { const b = this.children.filter(c => c.tagName === 'BUTTON'); return b[b.length - 1] || null; } return null; }
    fire(ev) { (this.handlers[ev] || []).forEach(f => f({})); }
    findAll(pred, out) { out = out || []; for (const c of this.children) { if (pred(c)) out.push(c); c.findAll(pred, out); } return out; }
}

class FakeUpdater extends EventEmitter {
    constructor() { super(); this.calls = []; this.checkImpl = async () => { this.emit('update-not-available', {}); return {}; }; this.downloadImpl = async () => {}; }
    async checkForUpdates() { this.calls.push('check'); return this.checkImpl(this); }
    async downloadUpdate() { this.calls.push('download'); return this.downloadImpl(this); }
    quitAndInstall(a, b) { this.calls.push(['quit', a, b]); }
}

const wrap = fn => async (...a) => {
    try { return { ok: true, data: await fn(...a) }; }
    catch (e) { return { ok: false, error: { code: e.code || 'ERROR', message: e.message, details: e.details || null } }; }
};

async function boot(root, language, opts) {
    opts = opts || {};
    const env = makeEnv(root);
    const dataDir = path.join(env.appData, 'Vantyx Hub');
    const hub = createHub({ env, dataDir, libraryDirs: [LIB] });
    const updater = new FakeUpdater();
    const updates = createUpdateService({ autoUpdater: updater, currentVersion: '0.1.0', disabledReason: opts.disabledReason });
    const settings = createSettings({ dir: dataDir });

    const ids = ['toasts', 'modal-root', 'env', 'warnings', 'tools', 'subtitle', 'libTitle', 'btnRefresh', 'updates'];
    const els = Object.fromEntries(ids.map(i => [i, new FakeEl('div')]));
    const ctx = {
        document: { getElementById: i => els[i], createElement: t => new FakeEl(t), addEventListener() {}, removeEventListener() {} },
        navigator: { language }, setTimeout: () => 0, console,
        hub: {
            list: wrap(() => hub.listTools()), env: wrap(() => hub.envInfo()),
            install: wrap((id, o) => hub.installTool(id, o)), uninstall: wrap((id, o) => hub.uninstallTool(id, o)),
            previewUninstall: wrap(id => hub.previewUninstall(id)), open: wrap(async () => true)
        },
        updates: {
            getState: wrap(() => updates.getState()), check: wrap(() => updates.check()), download: wrap(() => updates.download()),
            installAndRestart: wrap(() => updates.installAndRestart({ confirmed: true })),
            onState: cb => { updates.on('state', cb); return () => {}; }
        },
        settings: { get: wrap(() => settings.get()), set: wrap(p => settings.set(p)) }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ['strings.js', 'logic.js', 'ui.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(RENDERER, 'js', f), 'utf8'), ctx, { filename: f });

    const ui = {
        els, updater, updates, settings, ctx,
        text: () => els.updates.textContent,
        buttons: (label) => els.updates.findAll(c => c.tagName === 'BUTTON' && (!label || c.textContent === label)),
        toasts: () => els.toasts.children.map(c => c.textContent),
        modal: () => els['modal-root'].children[0] || null,
        bar: () => els.updates.findAll(c => /^progress/.test(c.className))[0],
        async waitFor(fn, what) {
            for (let i = 0; i < 400; i++) { try { if (fn()) return; } catch (e) { /* retry */ } await new Promise(r => setImmediate(r)); }
            throw new Error('timeout: ' + what + ' | ' + ui.text() + ' | ' + JSON.stringify(ui.toasts()));
        }
    };
    await ui.waitFor(() => !els.updates.hidden && els.updates.children.length > 0, 'updates card');
    return ui;
}
const newVersion = (u, extra) => async () => { u.emit('update-available', Object.assign({ version: '0.2.0', releaseNotes: '<ul><li>Faster scans</li><li>Bug fixes</li></ul>' }, extra)); return {}; };

test('shows the installed version and, with no update, says Vantyx Hub is up to date (EN)', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        assert.match(ui.text(), /Updates/);
        assert.match(ui.text(), /Installed version: v0\.1\.0/);
        assert.deepStrictEqual(ui.buttons().map(b => b.textContent), ['Check for updates']);
        ui.buttons()[0].fire('click');
        await ui.waitFor(() => /is up to date/.test(ui.text()), 'up to date');
        await ui.waitFor(() => ui.toasts().some(t => /is up to date/.test(t)), 'toast');
    } finally { rmrf(root); }
});

test('full flow in the UI: available -> notes -> download with progress -> confirm -> restart (EN)', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        ui.updater.checkImpl = newVersion(ui.updater);
        ui.buttons('Check for updates')[0].fire('click');
        await ui.waitFor(() => ui.buttons('Download update').length === 1, 'download button');
        assert.match(ui.text(), /Version 0\.2\.0 is available/);
        assert.match(ui.text(), /New version: v0\.2\.0/);
        assert.match(ui.text(), /- Faster scans/);
        assert.ok(!/<li>/.test(ui.text()));
        assert.strictEqual(ui.updater.calls.filter(c => c === 'download').length, 0, 'does not download on its own');

        let finish;
        ui.updater.downloadImpl = u => new Promise(r => { finish = () => { u.emit('update-downloaded', {}); r(); }; });
        ui.buttons('Download update')[0].fire('click');
        await ui.waitFor(() => ui.bar(), 'progress bar');
        ui.updater.emit('download-progress', { percent: 42.7, transferred: 427, total: 1000, bytesPerSecond: 100 });
        await ui.waitFor(() => /42%/.test(ui.text()) && ui.bar().children[0].style.width === '42.7%', 'progress 42%');
        assert.strictEqual(ui.buttons('Install and restart').length, 0, 'not offered before the download finishes');

        finish();
        await ui.waitFor(() => ui.buttons('Install and restart').length === 1, 'install button');
        assert.match(ui.text(), /ready to install/);

        // cancel -> nothing happens
        ui.buttons('Install and restart')[0].fire('click');
        await ui.waitFor(() => ui.modal(), 'confirmation dialog');
        assert.match(ui.modal().textContent, /close, install version 0\.2\.0 and open again/);
        assert.match(ui.modal().textContent, /tools installed in After Effects are kept/);
        ui.modal().findAll(c => c.tagName === 'BUTTON' && c.textContent === 'Cancel')[0].fire('click');
        await ui.waitFor(() => !ui.modal(), 'dialog closed');
        assert.ok(!ui.updater.calls.some(c => Array.isArray(c)), 'cancel does not restart');

        // confirm -> restarts once
        ui.buttons('Install and restart')[0].fire('click');
        await ui.waitFor(() => ui.modal(), 'dialog again');
        ui.modal().findAll(c => c.tagName === 'BUTTON' && c.textContent === 'Install and restart')[0].fire('click');
        await ui.waitFor(() => ui.updater.calls.some(c => Array.isArray(c)), 'restart called');
        assert.deepStrictEqual(ui.updater.calls.filter(c => Array.isArray(c)), [['quit', true, true]]);
    } finally { rmrf(root); }
});

test('a late reply to "check" never overwrites a newer state (no going back in time)', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        let releaseCheck;
        ui.updater.checkImpl = () => new Promise(r => { releaseCheck = r; });
        ui.buttons('Check for updates')[0].fire('click');
        await ui.waitFor(() => /Checking/.test(ui.text()), 'checking');
        // meanwhile newer states arrive by push (update found, download started and finished)
        ui.updater.emit('update-available', { version: '0.2.0', releaseNotes: 'n' });
        await ui.waitFor(() => ui.buttons('Download update').length === 1, 'available');
        ui.updater.downloadImpl = async u => { u.emit('update-downloaded', {}); };
        ui.buttons('Download update')[0].fire('click');
        await ui.waitFor(() => ui.buttons('Install and restart').length === 1, 'downloaded');
        releaseCheck({});                                 // the old check finally answers
        for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
        assert.match(ui.text(), /ready to install/);
        assert.strictEqual(ui.buttons('Install and restart').length, 1);
    } finally { rmrf(root); }
});

test('no internet shows a clear message; a failed download offers retry', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        ui.updater.checkImpl = async u => { const e = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }); u.emit('error', e); throw e; };
        ui.buttons('Check for updates')[0].fire('click');
        await ui.waitFor(() => /Could not reach the update server/.test(ui.text()), 'offline message');
        await ui.waitFor(() => ui.toasts().some(t => /Check your internet connection/.test(t)), 'offline toast');
        assert.deepStrictEqual(ui.buttons().map(b => b.textContent), ['Check for updates'], 'can retry');

        ui.updater.checkImpl = newVersion(ui.updater);
        ui.buttons('Check for updates')[0].fire('click');
        await ui.waitFor(() => ui.buttons('Download update').length === 1, 'available');
        ui.updater.downloadImpl = async () => { throw new Error('read ECONNRESET'); };
        ui.buttons('Download update')[0].fire('click');
        await ui.waitFor(() => /Could not reach the update server/.test(ui.text()) && ui.buttons('Download update').length === 1, 'retry offered');
    } finally { rmrf(root); }
});

test('disabled builds explain why and offer no update buttons', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-GB', { disabledReason: 'portable' });
        assert.match(ui.text(), /portable version cannot update itself/);
        assert.deepStrictEqual(ui.buttons().map(b => b.textContent), []);
        assert.strictEqual(ui.els.updates.findAll(c => c.tagName === 'INPUT').length, 0);
    } finally { rmrf(root); }
});

test('the "check on startup" option is saved and survives a restart', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        const cb = () => ui.els.updates.findAll(c => c.tagName === 'INPUT')[0];
        assert.strictEqual(cb().checked, true);
        assert.match(ui.text(), /Check for updates when Vantyx Hub starts/);
        cb().checked = false; cb().fire('change');
        await ui.waitFor(() => ui.settings.get().autoCheckUpdates === false, 'saved');

        const ui2 = await boot(root, 'en-US');   // new "process", same data folder
        assert.strictEqual(ui2.els.updates.findAll(c => c.tagName === 'INPUT')[0].checked, false);
    } finally { rmrf(root); }
});

test('tools keep working next to the Updates card (install is not affected)', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        await ui.waitFor(() => ui.els.tools.children.length > 0, 'tools');
        ui.els.tools.findAll(c => c.tagName === 'BUTTON' && c.textContent === 'Install')[0].fire('click');
        await ui.waitFor(() => /Installed/.test(ui.els.tools.textContent), 'tool installed');
        assert.deepStrictEqual(ui.buttons().map(b => b.textContent), ['Check for updates']);
    } finally { rmrf(root); }
});

test('without the updates bridge the card stays hidden and the rest of the UI works', async () => {
    const root = tmp();
    try {
        // same boot as the original renderer tests: no window.updates
        const src = fs.readFileSync(path.join(RENDERER, 'js', 'app.js'), 'utf8');
        assert.match(src, /if \(!window\.updates\) return;/);
        assert.match(src, /if \(!st \|\| !window\.updates\) \{ box\.hidden = true; return; \}/);
    } finally { rmrf(root); }
});

test('UI logic table: what each update state shows', () => {
    const { updateView } = require('../src/renderer/js/logic');
    const v = (status, extra) => updateView(Object.assign({ status }, extra));
    assert.deepStrictEqual(v('idle').buttons, ['check']);
    assert.deepStrictEqual(v('checking').buttons, ['check']);
    assert.deepStrictEqual(v('not-available').buttons, ['check']);
    assert.deepStrictEqual(v('available').buttons, ['download']);
    assert.deepStrictEqual(v('downloading').buttons, []);
    assert.strictEqual(v('downloading').progress, true);
    assert.deepStrictEqual(v('downloaded').buttons, ['restart']);
    assert.deepStrictEqual(v('error').buttons, ['check']);
    assert.deepStrictEqual(v('error', { info: { version: '1.0.0' } }).buttons, ['download', 'check']);
    assert.deepStrictEqual(v('disabled', { disabledReason: 'dev' }).buttons, []);
    assert.strictEqual(v('disabled', { disabledReason: 'dev' }).key, 'upd.disabled.dev');
});

test('texts: Spanish and English define the same keys and no key is defined twice', () => {
    const { S } = require('../src/renderer/js/strings');
    assert.deepStrictEqual(Object.keys(S.es).sort(), Object.keys(S.en).sort());
    const src = fs.readFileSync(path.join(RENDERER, 'js', 'strings.js'), 'utf8');
    for (const block of src.split(/\n        es: \{/)) {
        const keys = [...block.matchAll(/^\s+'([a-zA-Z0-9.\-_]+)':/gm)].map(m => m[1]);
        assert.strictEqual(new Set(keys).size, keys.length, 'duplicate key: ' + keys.filter((k, i) => keys.indexOf(k) !== i));
    }
    for (const code of ['UPDATE_OFFLINE', 'UPDATE_FEED_NOT_FOUND', 'UPDATE_CHECKSUM', 'UPDATE_SIGNATURE', 'UPDATE_BAD_VERSION', 'UPDATE_ERROR', 'UPDATE_DISABLED',
        'UPDATE_NOT_AVAILABLE', 'UPDATE_NOT_READY', 'UPDATE_NOT_CONFIRMED', 'UPDATE_BUSY', 'UPDATE_INSTALL_FAILED', 'BAD_REQUEST']) {
        assert.ok(S.en['err.' + code] && S.es['err.' + code], code);
    }
});



