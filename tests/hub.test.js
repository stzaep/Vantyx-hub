'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createHub } = require('../src/core/hub');
const { detectAfterEffects } = require('../src/core/ae-detect');
const { tmp, rmrf, makeToolDir, makeToolZip, makeEnv, makeZip } = require('./helpers');

function mkHub(root, extra) {
    const env = makeEnv(root);
    const lib = path.join(root, 'library');
    fs.mkdirSync(lib, { recursive: true });
    const hub = createHub(Object.assign({ env, dataDir: path.join(env.appData, 'Vantyx Hub'), libraryDirs: [lib] }, extra || {}));
    return { hub, env, lib };
}
const stateOf = async (hub, id) => (await hub.listTools()).tools.find(t => t.id === id).targets[0];

test('end-to-end: list -> install -> repair -> uninstall', async () => {
    const root = tmp();
    try {
        const { hub, lib } = mkHub(root);
        makeToolDir(path.join(lib, 'test-tool'));
        let list = await hub.listTools();
        assert.strictEqual(list.tools.length, 1);
        assert.strictEqual(list.tools[0].targets[0].state, 'not-installed');

        const r = await hub.installTool('test-tool');
        assert.strictEqual(r.action, 'installed');
        assert.strictEqual((await stateOf(hub, 'test-tool')).state, 'installed');

        const t = await stateOf(hub, 'test-tool');
        fs.unlinkSync(path.join(t.installPath, 'client', 'index.html'));
        assert.strictEqual((await stateOf(hub, 'test-tool')).state, 'incomplete');
        await hub.installTool('test-tool', { repair: true });
        assert.strictEqual((await stateOf(hub, 'test-tool')).state, 'installed');

        assert.strictEqual(hub.getPaths('test-tool').install, t.installPath);
        await hub.uninstallTool('test-tool');
        assert.strictEqual((await stateOf(hub, 'test-tool')).state, 'not-installed');
    } finally { rmrf(root); }
});

test('library picks the newest version, accepts ZIP packages, and reports broken ones without crashing', async () => {
    const root = tmp();
    try {
        const { hub, lib } = mkHub(root);
        makeToolDir(path.join(lib, 'test-tool-1'));
        makeToolZip(path.join(lib, 'test-tool-2.vantyx'), { manifest: { version: '1.2.0' } });
        makeZip(path.join(lib, 'broken.vantyx'), [{ name: 'payload/x.txt', data: 'x' }]);
        const list = await hub.listTools();
        assert.strictEqual(list.tools.length, 1);
        assert.strictEqual(list.tools[0].version, '1.2.0');
        assert.deepStrictEqual(list.tools[0].versions, ['1.2.0', '1.0.0']);
        assert.strictEqual(list.problems.length, 1);
        assert.strictEqual(list.problems[0].code, 'MANIFEST_MISSING');
        const r = await hub.installTool('test-tool');
        assert.strictEqual(r.version, '1.2.0');
    } finally { rmrf(root); }
});

test('a tool installed earlier but missing from the library can still be uninstalled', async () => {
    const root = tmp();
    try {
        const { hub, lib } = mkHub(root);
        const pkg = makeToolDir(path.join(lib, 'test-tool'));
        await hub.installTool('test-tool');
        rmrf(pkg);
        const list = await hub.listTools();
        assert.strictEqual(list.tools[0].inLibrary, false);
        assert.strictEqual(list.tools[0].targets[0].state, 'installed');
        await hub.uninstallTool('test-tool');
        assert.strictEqual((await hub.listTools()).tools.length, 0);
    } finally { rmrf(root); }
});

test('a corrupt receipts file is set aside; nothing is deleted and tools show as unmanaged', async () => {
    const root = tmp();
    try {
        const { hub, lib, env } = mkHub(root);
        makeToolDir(path.join(lib, 'test-tool'));
        await hub.installTool('test-tool');
        fs.writeFileSync(path.join(env.appData, 'Vantyx Hub', 'receipts.json'), '{ broken');
        const list = await hub.listTools();
        assert.strictEqual(list.tools[0].targets[0].state, 'unmanaged');
        assert.ok(list.warning);
        assert.ok(fs.existsSync(path.join(env.appData, 'Adobe', 'CEP', 'extensions', 'TestTool', 'CSXS', 'manifest.xml')));
    } finally { rmrf(root); }
});

test('installTool for an unknown id fails cleanly', async () => {
    const root = tmp();
    try {
        const { hub } = mkHub(root);
        await assert.rejects(hub.installTool('nope-tool'), { code: 'TOOL_NOT_IN_LIBRARY' });
    } finally { rmrf(root); }
});

test('After Effects detection finds versions and ignores incomplete folders', () => {
    const root = tmp();
    try {
        const env = makeEnv(root);
        for (const n of ['Adobe After Effects 2024', 'Adobe After Effects 2025', 'Adobe After Effects (Beta)']) {
            const f = path.join(env.programFiles, 'Adobe', n, 'Support Files');
            fs.mkdirSync(f, { recursive: true });
            fs.writeFileSync(path.join(f, 'AfterFX.exe'), '');
        }
        fs.mkdirSync(path.join(env.programFiles, 'Adobe', 'Adobe After Effects 2020'), { recursive: true });   // leftover, no exe
        fs.mkdirSync(path.join(env.programFiles, 'Adobe', 'Adobe Premiere Pro 2025'), { recursive: true });
        const found = detectAfterEffects(env);
        assert.deepStrictEqual(found.map(f => f.label), ['2025', '2024', '(Beta)']);
        assert.ok(found[2].beta);
        assert.ok(found[0].scriptUiPanelsDir.endsWith(path.join('Scripts', 'ScriptUI Panels')));
        assert.deepStrictEqual(detectAfterEffects(makeEnv(path.join(root, 'empty'))), []);
    } finally { rmrf(root); }
});

test('envInfo reports debug-mode status through the runner', async () => {
    const root = tmp();
    try {
        const env = makeEnv(root, { platform: 'win32' });
        const runner = async (cmd, args) => (args[0] === 'query' && /CSXS\.(11|12)$/.test(args[1]))
            ? { code: 0, stdout: '\n    PlayerDebugMode    REG_SZ    1\n', stderr: '' }
            : { code: 1, stdout: '', stderr: 'not found' };
        const hub = createHub({ env, dataDir: path.join(root, 'd'), libraryDirs: [], runner });
        const info = await hub.envInfo();
        assert.deepStrictEqual(info.cepDebug.enabled, [11, 12]);
    } finally { rmrf(root); }
});
