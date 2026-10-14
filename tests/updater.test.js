'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createUpdateService, notesToText, parseFeedConfig, isFeedConfigured, classifyError } = require('../src/core/updater');
const { createHub } = require('../src/core/hub');
const { createSettings } = require('../src/core/settings');
const { tmp, rmrf, makeEnv } = require('./helpers');

// Stand-in for electron-updater's autoUpdater.
class FakeUpdater extends EventEmitter {
    constructor() { super(); this.calls = []; this.checkImpl = async () => ({ updateInfo: {}, isUpdateAvailable: false }); this.downloadImpl = async () => {}; }
    async checkForUpdates() { this.calls.push('check'); return this.checkImpl(this); }
    async downloadUpdate() { this.calls.push('download'); return this.downloadImpl(this); }
    quitAndInstall(silent, run) { this.calls.push(['quitAndInstall', silent, run]); }
}
function make(over, current) {
    const u = new FakeUpdater();
    const svc = createUpdateService(Object.assign({ autoUpdater: u, currentVersion: current || '0.1.0' }, over || {}));
    return { u, svc };
}
const available = (version, extra) => async u => { const info = Object.assign({ version, releaseNotes: '<p>Fixes</p>' }, extra); u.emit('update-available', info); return { updateInfo: info, isUpdateAvailable: true }; };

test('detects an available update and exposes version and plain-text notes', async () => {
    const { u, svc } = make();
    u.checkImpl = available('0.2.0', { releaseNotes: '<h2>New</h2><ul><li>Faster</li><li>Safer &amp; smaller</li></ul><script>alert(1)</script>', releaseDate: '2026-10-01' });
    const st = await svc.check();
    assert.strictEqual(st.status, 'available');
    assert.strictEqual(st.info.version, '0.2.0');
    assert.ok(!/[<>]/.test(st.info.notes.replace(/alert\(1\)/, '')), 'html tags stripped');
    assert.match(st.info.notes, /- Faster/);
    assert.match(st.info.notes, /Safer & smaller/);
    assert.ok(st.lastChecked);
});

test('reports "up to date" when there is no update, the same version, or an older one', async () => {
    const a = make(); a.u.checkImpl = async u => { u.emit('update-not-available', {}); return { isUpdateAvailable: false }; };
    assert.strictEqual((await a.svc.check()).status, 'not-available');

    const b = make({}, '0.2.0'); b.u.checkImpl = available('0.2.0');
    assert.strictEqual((await b.svc.check()).status, 'not-available');

    const c = make({}, '0.2.0'); c.u.checkImpl = available('0.1.5');
    const st = await c.svc.check();
    assert.strictEqual(st.status, 'not-available', 'never downgrade');
    assert.strictEqual(st.info, null);
});

test('rejects invalid versions in the feed', async () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'x.y.z', null, undefined, '../../1.0.0']) {
        const { u, svc } = make(); u.checkImpl = available(bad);
        const st = await svc.check();
        assert.strictEqual(st.status, 'error', String(bad));
        assert.strictEqual(st.error.code, 'UPDATE_BAD_VERSION');
        await assert.rejects(() => svc.download(), e => e.code === 'UPDATE_NOT_AVAILABLE');
    }
    assert.throws(() => createUpdateService({ autoUpdater: new FakeUpdater(), currentVersion: 'dev' }));
});

test('never downloads or installs by itself', async () => {
    const { u, svc } = make();
    assert.strictEqual(u.autoDownload, false);
    assert.strictEqual(u.autoInstallOnAppQuit, false);
    assert.strictEqual(u.allowDowngrade, false);
    u.checkImpl = available('0.2.0');
    await svc.check();
    assert.deepStrictEqual(u.calls, ['check']);
});

test('download progress is real, monotonic and ends in "downloaded"', async () => {
    const { u, svc } = make();
    u.checkImpl = available('0.2.0');
    await svc.check();
    const seen = [];
    svc.on('state', s => seen.push([s.status, s.progress && Math.floor(s.progress.percent)]));
    u.downloadImpl = async () => {
        for (const percent of [5, 5.4, 33.3, 33.9, 70, 99.5, 100]) u.emit('download-progress', { percent, transferred: percent * 10, total: 1000, bytesPerSecond: 500 });
        u.emit('update-downloaded', { version: '0.2.0' });
    };
    const st = await svc.download();
    assert.strictEqual(st.status, 'downloaded');
    const pcts = seen.filter(s => s[0] === 'downloading').map(s => s[1]);
    assert.deepStrictEqual(pcts, [0, 5, 33, 70, 99, 100]);          // duplicates within the same integer % are dropped
    assert.deepStrictEqual(pcts, pcts.slice().sort((a, b) => a - b));
    assert.strictEqual(seen[seen.length - 1][0], 'downloaded');
});

test('an interrupted or corrupt download becomes an error that can be retried', async () => {
    const { u, svc } = make();
    u.checkImpl = available('0.2.0');
    await svc.check();
    u.downloadImpl = async () => { u.emit('download-progress', { percent: 40 }); throw new Error('read ECONNRESET'); };
    let st = await svc.download();
    assert.strictEqual(st.status, 'error');
    assert.strictEqual(st.error.code, 'UPDATE_OFFLINE');
    assert.strictEqual(st.info.version, '0.2.0', 'keeps the update info so the UI can offer a retry');
    assert.strictEqual(st.progress, null);

    u.downloadImpl = async () => { throw new Error('sha512 checksum mismatch, expected abc, got def'); };
    st = await svc.download();
    assert.strictEqual(st.error.code, 'UPDATE_CHECKSUM');

    u.downloadImpl = async () => { u.emit('update-downloaded', {}); };
    st = await svc.download();
    assert.strictEqual(st.status, 'downloaded');
});

test('no internet: check fails with UPDATE_OFFLINE, stays usable and recovers', async () => {
    const { u, svc } = make();
    const offline = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ERR_INTERNET_DISCONNECTED' });
    u.checkImpl = async () => { u.emit('error', offline); throw offline; };   // electron-updater both emits and rejects
    let st = await svc.check();
    assert.strictEqual(st.status, 'error');
    assert.strictEqual(st.error.code, 'UPDATE_OFFLINE');

    for (const msg of ['getaddrinfo ENOTFOUND github.com', 'connect ETIMEDOUT 140.82.0.1:443', 'connect ECONNREFUSED', 'net::ERR_NAME_NOT_RESOLVED']) {
        assert.strictEqual(classifyError(new Error(msg)).code, 'UPDATE_OFFLINE', msg);
    }
    assert.strictEqual(classifyError(new Error('Cannot find latest.yml in the latest release artifacts (HttpError: 404)')).code, 'UPDATE_FEED_NOT_FOUND');

    u.checkImpl = available('0.3.0');                // connection is back
    st = await svc.check();
    assert.strictEqual(st.status, 'available');
    assert.strictEqual(st.error, null);
});

test('concurrent checks do not start a second request', async () => {
    const { u, svc } = make();
    let release; u.checkImpl = () => new Promise(r => { release = r; });
    const p1 = svc.check(); const p2 = svc.check();
    assert.strictEqual((await p2).status, 'checking');
    release({ isUpdateAvailable: false });
    await p1;
    assert.strictEqual(u.calls.filter(c => c === 'check').length, 1);
});

async function downloaded(over) {
    const ctx = make(over);
    ctx.u.checkImpl = available('0.2.0');
    await ctx.svc.check();
    ctx.u.downloadImpl = async u => { u.emit('update-downloaded', {}); };
    await ctx.svc.download();
    return ctx;
}

test('restart requires explicit confirmation, a downloaded update and no tool operation running', async () => {
    const early = make();
    assert.throws(() => early.svc.installAndRestart({ confirmed: true }), e => e.code === 'UPDATE_NOT_READY');

    let busy = true;
    const { u, svc } = await downloaded({ canInstall: () => !busy });
    for (const arg of [undefined, null, {}, { confirmed: false }, { confirmed: 'true' }, { confirmed: 1 }, true]) {
        assert.throws(() => svc.installAndRestart(arg), e => e.code === 'UPDATE_NOT_CONFIRMED');
    }
    assert.throws(() => svc.installAndRestart({ confirmed: true }), e => e.code === 'UPDATE_BUSY');
    assert.ok(!u.calls.some(c => Array.isArray(c)), 'quitAndInstall was not called');

    busy = false;
    svc.installAndRestart({ confirmed: true });
    svc.installAndRestart({ confirmed: true });          // double click
    assert.deepStrictEqual(u.calls.filter(c => Array.isArray(c)), [['quitAndInstall', true, true]]);
});

test('a failing installer is reported and the app stays on the current version', async () => {
    const { u, svc } = await downloaded();
    u.quitAndInstall = () => { throw new Error('spawn EPERM'); };
    assert.throws(() => svc.installAndRestart({ confirmed: true }), e => e.code === 'UPDATE_INSTALL_FAILED');
    assert.strictEqual(svc.getState().status, 'error');
    assert.strictEqual(svc.getState().currentVersion, '0.1.0');
});

test('disabled builds (dev / portable / unconfigured) never touch the network', async () => {
    for (const reason of ['dev', 'portable', 'not-configured']) {
        const { u, svc } = make({ disabledReason: reason });
        assert.strictEqual(svc.getState().status, 'disabled');
        assert.strictEqual(svc.getState().disabledReason, reason);
        await assert.rejects(() => svc.check(), e => e.code === 'UPDATE_DISABLED');
        assert.deepStrictEqual(u.calls, []);
        assert.strictEqual(u.autoDownload, undefined, 'updater not even configured');
    }
});

test('notes: html, release-note arrays and very long text', () => {
    assert.strictEqual(notesToText('<p>Hello&nbsp;<b>world</b></p>'), 'Hello world');
    assert.strictEqual(notesToText([{ version: '0.2.0', note: 'A' }, { version: '0.1.1', note: 'B' }]), 'v0.2.0\nA\n\nv0.1.1\nB');
    assert.strictEqual(notesToText(null), '');
    assert.ok(notesToText('x'.repeat(10000)).length <= 4001);
});

test('feed config: placeholders and non-https feeds count as "not configured"', () => {
    assert.deepStrictEqual(parseFeedConfig('owner: vantyx\nrepo: hub\nprovider: github\nupdaterCacheDirName: vantyx-hub-updater\n'),
        { owner: 'vantyx', repo: 'hub', provider: 'github', updaterCacheDirName: 'vantyx-hub-updater' });
    assert.strictEqual(isFeedConfigured({ provider: 'github', owner: 'acme', repo: 'hub' }), true);
    assert.strictEqual(isFeedConfigured({ provider: 'github', owner: 'YOUR_GITHUB_USER', repo: 'hub' }), false);
    assert.strictEqual(isFeedConfigured({ provider: 'github', owner: 'acme', repo: 'YOUR_REPOSITORY_NAME' }), false);
    assert.strictEqual(isFeedConfigured({ provider: 'generic', url: 'https://updates.example.com/hub' }), true);
    assert.strictEqual(isFeedConfigured({ provider: 'generic', url: 'http://updates.example.com/hub' }), false);
    assert.strictEqual(isFeedConfigured({ provider: 'custom', url: 'https://x' }), false);
    assert.strictEqual(isFeedConfigured(null), false);
});

test('the updater is independent from the tool installer (separation of concerns)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'updater.js'), 'utf8');
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
    assert.deepStrictEqual(requires.sort(), ['./errors', './version', 'events']);
});

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function walk(d, out = []) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }

test('updating the Hub keeps preferences, receipts and installed tools exactly as they were', async () => {
    const root = tmp();
    try {
        const env = makeEnv(root);
        const dataDir = path.join(env.appData, 'Vantyx Hub');
        const lib = path.join(__dirname, '..', 'library');
        const hubOf = () => createHub({ env, dataDir, libraryDirs: [lib] });

        // before the update: a tool is installed and the user changed a preference
        const hub = hubOf();
        await hub.installTool('vantyx-organizer', {});
        createSettings({ dir: dataDir }).set({ autoCheckUpdates: false });
        const toolDir = path.join(env.appData, 'Adobe', 'CEP', 'extensions', 'VantyxOrganizer');
        const snapshot = () => Object.fromEntries([...walk(toolDir), path.join(dataDir, 'receipts.json'), path.join(dataDir, 'settings.json')].map(f => [f, sha(f)]));
        const before = snapshot();

        // the whole update flow
        const { u, svc } = make();
        u.checkImpl = available('0.2.0');
        await svc.check();
        u.downloadImpl = async x => { x.emit('download-progress', { percent: 50 }); x.emit('update-downloaded', {}); };
        await svc.download();
        svc.installAndRestart({ confirmed: true });
        assert.deepStrictEqual(snapshot(), before, 'no file of the tools, receipts or settings changed');

        // "new version starts": fresh hub + settings read the same data; nothing is reinstalled or flagged
        const list = await hubOf().listTools();
        const tool = list.tools.find(t => t.id === 'vantyx-organizer');
        assert.strictEqual(tool.targets[0].state, 'installed');
        assert.strictEqual(createSettings({ dir: dataDir }).get().autoCheckUpdates, false);
    } finally { rmrf(root); }
});
