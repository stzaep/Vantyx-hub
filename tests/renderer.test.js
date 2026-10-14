'use strict';
// Runs the real UI scripts (strings, logic, ui, app) against a minimal fake DOM
// and the real core, on temp folders. Catches wiring errors without Electron.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHub } = require('../src/core/hub');
const { tmp, rmrf, makeEnv } = require('./helpers');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const LIB = path.join(__dirname, '..', 'library');

class FakeEl {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.className = ''; this.children = []; this.parentNode = null; this._text = ''; this.handlers = {}; this.checked = false; this.type = ''; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
    setAttribute() {}
    focus() {}
    querySelector(sel) { if (sel === 'button:last-child') { const b = this.children.filter(c => c.tagName === 'BUTTON'); return b[b.length - 1] || null; } return null; }
    click() { (this.handlers.click || []).forEach(f => f({})); }
    findAll(pred, out) { out = out || []; for (const c of this.children) { if (pred(c)) out.push(c); c.findAll(pred, out); } return out; }
}

function bridge(hub) {
    const w = fn => async (...a) => {
        try { return { ok: true, data: await fn(...a) }; }
        catch (e) { return { ok: false, error: { code: e.code || 'ERROR', message: e.message, details: e.details || null } }; }
    };
    return {
        list: w(() => hub.listTools()), env: w(() => hub.envInfo()),
        install: w((id, o) => hub.installTool(id, o)), uninstall: w((id, o) => hub.uninstallTool(id, o)),
        previewUninstall: w(id => hub.previewUninstall(id)), open: w(async () => { const e = new Error('x'); e.code = 'NOTHING_TO_OPEN'; throw e; })
    };
}

async function boot(root, language) {
    const env = makeEnv(root);
    const testLib = path.join(root, 'library');
    fs.mkdirSync(testLib, { recursive: true });
    fs.cpSync(path.join(LIB, 'vantyx-organizer'), path.join(testLib, 'vantyx-organizer'), { recursive: true });
    const hub = createHub({ env, dataDir: path.join(env.appData, 'Vantyx Hub'), libraryDirs: [testLib] });
    const ids = ['toasts', 'modal-root', 'env', 'warnings', 'tools', 'subtitle', 'libTitle', 'btnRefresh'];
    const els = Object.fromEntries(ids.map(i => [i, new FakeEl('div')]));
    const errors = [];
    const ctx = {
        document: { getElementById: i => els[i], createElement: t => new FakeEl(t), addEventListener() {}, removeEventListener() {} },
        navigator: { language }, setTimeout: () => 0, console, hub: bridge(hub)
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ['strings.js', 'logic.js', 'ui.js', 'app.js']) {
        vm.runInContext(fs.readFileSync(path.join(RENDERER, 'js', f), 'utf8'), ctx, { filename: f });
    }
    const ui = {
        els, env,
        dest: path.join(env.appData, 'Adobe', 'CEP', 'extensions', 'VantyxOrganizer'),
        userData: path.join(env.appData, 'VantyxOrganizer'),
        status: () => { const s = els.tools.findAll(c => /^tool-status/.test(c.className))[0]; return s ? s.children[1].textContent : null; },
        buttons: (scope, label) => scope.findAll(c => c.tagName === 'BUTTON' && (!label || c.textContent === label)),
        toasts: () => els.toasts.children.map(c => c.textContent),
        modal: () => els['modal-root'].children[0] || null,
        async waitFor(fn, what) {
            for (let i = 0; i < 400; i++) { try { if (fn()) return; } catch (e) { /* retry */ } await new Promise(r => setImmediate(r)); }
            throw new Error('timeout waiting for ' + what + ' | status=' + ui.status() + ' toasts=' + JSON.stringify(ui.toasts()));
        }
    };
    await ui.waitFor(() => ui.els.tools.children.length > 0, 'first render');
    return ui;
}

test('renders the library, installs, detects damage, repairs and uninstalls (English UI)', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'es-ES');
        assert.match(ui.els.tools.textContent, /Vantyx Organizer/);
        assert.strictEqual(ui.status(), 'Not installed');
        assert.strictEqual(ui.els.subtitle.textContent, 'TOOL MANAGER FOR AFTER EFFECTS');
        assert.deepStrictEqual(ui.buttons(ui.els.tools).map(b => b.textContent), ['Install']);

        ui.buttons(ui.els.tools, 'Install')[0].click();
        await ui.waitFor(() => ui.status() === 'Installed', 'installed');
        assert.ok(ui.toasts().some(t => /installed/.test(t)));
        assert.deepStrictEqual(ui.buttons(ui.els.tools).map(b => b.textContent), ['Uninstall', 'Open folder']);
        assert.ok(fs.existsSync(path.join(ui.dest, 'CSXS', 'manifest.xml')));

        fs.unlinkSync(path.join(ui.dest, 'host', 'modules', 'scan.jsx'));
        ui.els.btnRefresh.click();
        await ui.waitFor(() => ui.status() === 'Incomplete installation', 'incomplete');
        assert.match(ui.els.tools.textContent, /Missing files \(1\): host\/modules\/scan\.jsx/);

        ui.buttons(ui.els.tools, 'Repair')[0].click();
        await ui.waitFor(() => ui.status() === 'Installed', 'repaired');
        assert.ok(fs.existsSync(path.join(ui.dest, 'host', 'modules', 'scan.jsx')));

        // uninstall: user data found -> checkbox shown, unchecked -> data kept
        fs.mkdirSync(ui.userData, { recursive: true });
        fs.writeFileSync(path.join(ui.userData, 'config.json'), '{}');
        ui.buttons(ui.els.tools, 'Uninstall')[0].click();
        await ui.waitFor(() => ui.modal(), 'uninstall modal');
        assert.match(ui.modal().textContent, /Also delete my settings and data/);
        assert.ok(ui.modal().textContent.includes(ui.userData));
        ui.buttons(ui.modal(), 'Uninstall')[0].click();
        await ui.waitFor(() => ui.status() === 'Not installed', 'uninstalled');
        assert.ok(!fs.existsSync(ui.dest));
        assert.ok(fs.existsSync(path.join(ui.userData, 'config.json')), 'user data must be kept by default');
        assert.ok(ui.toasts().some(t => /kept/.test(t)));
    } finally { rmrf(root); }
});

test('cancelling the uninstall dialog changes nothing; ticking the box deletes user data', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        assert.strictEqual(ui.status(), 'Not installed');
        ui.buttons(ui.els.tools, 'Install')[0].click();
        await ui.waitFor(() => ui.status() === 'Installed', 'installed');
        fs.mkdirSync(ui.userData, { recursive: true });
        fs.writeFileSync(path.join(ui.userData, 'config.json'), '{}');

        ui.buttons(ui.els.tools, 'Uninstall')[0].click();
        await ui.waitFor(() => ui.modal(), 'modal');
        ui.buttons(ui.modal(), 'Cancel')[0].click();
        await ui.waitFor(() => !ui.modal(), 'modal closed');
        assert.strictEqual(ui.status(), 'Installed');

        ui.buttons(ui.els.tools, 'Uninstall')[0].click();
        await ui.waitFor(() => ui.modal(), 'modal 2');
        const box = ui.modal().findAll(c => c.tagName === 'INPUT')[0];
        box.checked = true;
        ui.buttons(ui.modal(), 'Uninstall')[0].click();
        await ui.waitFor(() => ui.status() === 'Not installed', 'uninstalled');
        assert.ok(!fs.existsSync(ui.userData));
        assert.ok(ui.toasts().some(t => /deleted/.test(t)));
    } finally { rmrf(root); }
});

test('an existing unmanaged folder asks before replacing and keeps a backup', async () => {
    const root = tmp();
    try {
        const ui = await boot(root, 'en-US');
        fs.mkdirSync(ui.dest, { recursive: true });
        fs.writeFileSync(path.join(ui.dest, 'old-version.txt'), 'legacy');
        ui.els.btnRefresh.click();
        await ui.waitFor(() => ui.status() === 'Found, not installed by the Hub', 'unmanaged');

        ui.buttons(ui.els.tools, 'Install')[0].click();
        await ui.waitFor(() => ui.modal(), 'replace modal');
        assert.match(ui.modal().textContent, /already exists/);
        ui.buttons(ui.modal(), 'Cancel')[0].click();
        await ui.waitFor(() => !ui.modal(), 'closed');
        assert.ok(fs.existsSync(path.join(ui.dest, 'old-version.txt')), 'cancel must leave the folder untouched');

        ui.buttons(ui.els.tools, 'Install')[0].click();
        await ui.waitFor(() => ui.modal(), 'replace modal 2');
        ui.buttons(ui.modal(), 'Replace')[0].click();
        await ui.waitFor(() => ui.status() === 'Installed', 'installed after replace');
        assert.ok(!fs.existsSync(path.join(ui.dest, 'old-version.txt')));
        assert.ok(ui.toasts().some(t => /previous folder was saved/.test(t)));
    } finally { rmrf(root); }
});

test('error texts are localized and never show a raw code', () => {
    const strings = require('../src/renderer/js/strings.js');
    assert.match(strings.errorText({ code: 'NOT_MANAGED', message: 'x' }), /instal/i);
    assert.match(strings.errorText({ code: 'SOMETHING_NEW', message: 'boom' }), /boom/);      // unknown code keeps the detail
    assert.doesNotMatch(strings.errorText({ code: 'DOWNGRADE_BLOCKED', message: 'raw english detail' }), /raw english/);
    assert.strictEqual(strings.t('toast.installed', { name: 'A', v: '1.0.0' }), 'A v1.0.0 installed.');
    // both dictionaries define exactly the same keys
    assert.deepStrictEqual(Object.keys(strings.S.en).sort(), Object.keys(strings.S.es).sort());
});

test('button logic per state', () => {
    const logic = require('../src/renderer/js/logic.js');
    const tool = { inLibrary: true };
    const A = s => logic.actionsFor(tool, { state: s });
    assert.deepStrictEqual(A('not-installed'), ['install']);
    assert.deepStrictEqual(A('unmanaged'), ['install']);
    assert.deepStrictEqual(A('installed'), ['uninstall', 'open']);
    assert.deepStrictEqual(A('outdated'), ['update', 'uninstall', 'open']);
    assert.deepStrictEqual(A('incomplete'), ['repair', 'uninstall', 'open']);
    assert.deepStrictEqual(A('modified'), ['repair', 'uninstall', 'open']);
    assert.deepStrictEqual(A('error'), []);
    assert.deepStrictEqual(logic.actionsFor({ inLibrary: false }, { state: 'not-installed' }), []);
    assert.strictEqual(logic.installMode({ state: 'incomplete' }), 'repair');
    assert.strictEqual(logic.installMode({ state: 'outdated' }), 'install');
    assert.strictEqual(logic.shortList(['a', 'b', 'c', 'd']), 'a, b, c, \u2026');
});


