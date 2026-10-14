'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { install } = require('../src/core/installer');
const { openPackage } = require('../src/core/package-reader');
const { inspectInstall } = require('../src/core/status');
const { tmp, rmrf, makeToolDir, makeToolZip, toolFiles, makeCtx } = require('./helpers');

function setup(opts) {
    const root = tmp();
    const pkgDir = makeToolDir(path.join(root, 'pkg1'), opts);
    const ctx = makeCtx(root);
    const extRoot = path.join(ctx.env.appData, 'Adobe', 'CEP', 'extensions');
    return { root, ctx, pkgDir, extRoot, dest: path.join(extRoot, 'TestTool'), pkg: () => openPackage(pkgDir) };
}
const state = (s, pkgVersion) => inspectInstall({ receipt: s.ctx.receipts.get('test-tool', 'user'), installRoot: s.dest, pkgVersion });

test('fresh install writes the files, the receipt, and reports installed', async () => {
    const s = setup();
    try {
        const r = await install(s.ctx, s.pkg());
        assert.strictEqual(r.action, 'installed');
        assert.strictEqual(r.written, 3);
        assert.ok(fs.existsSync(path.join(s.dest, 'CSXS', 'manifest.xml')));
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'client', 'index.html'), 'utf8'), '<html>v1</html>');
        const rec = s.ctx.receipts.get('test-tool', 'user');
        assert.strictEqual(rec.files.length, 3);
        assert.strictEqual(state(s, '1.0.0').state, 'installed');
        assert.deepStrictEqual(fs.readdirSync(s.extRoot), ['TestTool']);   // no staging leftovers
    } finally { rmrf(s.root); }
});

test('installing twice does not duplicate anything', async () => {
    const s = setup();
    try {
        await install(s.ctx, s.pkg());
        const r2 = await install(s.ctx, s.pkg());
        assert.strictEqual(r2.action, 'already-installed');
        assert.strictEqual(s.ctx.receipts.list().length, 1);
        assert.deepStrictEqual(fs.readdirSync(s.extRoot), ['TestTool']);
    } finally { rmrf(s.root); }
});

test('missing and modified files are detected; repair restores them', async () => {
    const s = setup();
    try {
        await install(s.ctx, s.pkg());
        fs.unlinkSync(path.join(s.dest, 'host', 'main.jsx'));
        let st = state(s, '1.0.0');
        assert.strictEqual(st.state, 'incomplete');
        assert.deepStrictEqual(st.missing, ['host/main.jsx']);

        const r = await install(s.ctx, s.pkg(), { repair: true });
        assert.strictEqual(r.action, 'repaired');
        assert.strictEqual(state(s, '1.0.0').state, 'installed');

        fs.writeFileSync(path.join(s.dest, 'client', 'index.html'), 'tampered');
        st = state(s, '1.0.0');
        assert.strictEqual(st.state, 'modified');
        assert.deepStrictEqual(st.modified, ['client/index.html']);
        await install(s.ctx, s.pkg(), { repair: true });
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'client', 'index.html'), 'utf8'), '<html>v1</html>');
    } finally { rmrf(s.root); }
});

test('update replaces changed files, removes obsolete ones, keeps foreign files', async () => {
    const s = setup();
    try {
        await install(s.ctx, s.pkg());
        fs.writeFileSync(path.join(s.dest, 'user-notes.txt'), 'mine');                 // foreign file
        const v2 = makeToolDir(path.join(s.root, 'pkg2'), {
            manifest: { version: '1.1.0' },
            files: toolFiles({ 'client/index.html': '<html>v2</html>', 'host/main.jsx': null, 'host/new.jsx': '// new' })
        });
        assert.strictEqual(state(s, '1.1.0').state, 'outdated');
        const r = await install(s.ctx, openPackage(v2));
        assert.strictEqual(r.action, 'updated');
        assert.strictEqual(r.previousVersion, '1.0.0');
        assert.strictEqual(r.removed, 1);
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'client', 'index.html'), 'utf8'), '<html>v2</html>');
        assert.ok(!fs.existsSync(path.join(s.dest, 'host', 'main.jsx')));
        assert.ok(fs.existsSync(path.join(s.dest, 'host', 'new.jsx')));
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'user-notes.txt'), 'utf8'), 'mine');
        assert.strictEqual(s.ctx.receipts.get('test-tool', 'user').version, '1.1.0');
    } finally { rmrf(s.root); }
});

test('downgrades are blocked unless explicitly allowed', async () => {
    const s = setup();
    try {
        const v2 = makeToolDir(path.join(s.root, 'pkg2'), { manifest: { version: '2.0.0' } });
        await install(s.ctx, openPackage(v2));
        await assert.rejects(install(s.ctx, s.pkg()), { code: 'DOWNGRADE_BLOCKED' });
        const r = await install(s.ctx, s.pkg(), { allowDowngrade: true });
        assert.strictEqual(r.version, '1.0.0');
    } finally { rmrf(s.root); }
});

test('an existing folder not installed by the Hub is never overwritten silently', async () => {
    const s = setup();
    try {
        fs.mkdirSync(s.dest, { recursive: true });
        fs.writeFileSync(path.join(s.dest, 'old.txt'), 'legacy');
        await assert.rejects(install(s.ctx, s.pkg()), e => e.code === 'UNMANAGED_EXISTS' && e.details.path === s.dest);
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'old.txt'), 'utf8'), 'legacy');
        assert.strictEqual(inspectInstall({ receipt: null, installRoot: s.dest }).state, 'unmanaged');

        const r = await install(s.ctx, s.pkg(), { replaceUnmanaged: true });
        assert.ok(r.backupPath && fs.readFileSync(path.join(r.backupPath, 'old.txt'), 'utf8') === 'legacy');
        assert.ok(!fs.existsSync(path.join(s.dest, 'old.txt')));
        assert.strictEqual(state(s, '1.0.0').state, 'installed');
    } finally { rmrf(s.root); }
});

test('a failure in the middle of an install rolls everything back (fresh install)', async () => {
    const s = setup();
    try {
        s.ctx.hooks = { afterWrite: i => { if (i === 1) throw new Error('disk exploded'); } };
        await assert.rejects(install(s.ctx, s.pkg()), e => e.code === 'INSTALL_FAILED' && e.details.rolledBack === true);
        assert.ok(!fs.existsSync(s.dest), 'install folder must not exist');
        assert.strictEqual(s.ctx.receipts.list().length, 0);
        assert.ok(!fs.existsSync(path.join(s.ctx.dataDir, 'tmp')) || fs.readdirSync(path.join(s.ctx.dataDir, 'tmp')).length === 0);
    } finally { rmrf(s.root); }
});

test('a failure during an update restores the previous version intact', async () => {
    const s = setup();
    try {
        await install(s.ctx, s.pkg());
        const v2 = makeToolDir(path.join(s.root, 'pkg2'), {
            manifest: { version: '1.1.0' },
            files: toolFiles({ 'client/index.html': '<html>v2</html>', 'host/main.jsx': null, 'host/new.jsx': '// new' })
        });
        s.ctx.hooks = { afterWrite: i => { if (i === 2) throw new Error('boom'); } };
        await assert.rejects(install(s.ctx, openPackage(v2)), { code: 'INSTALL_FAILED' });
        s.ctx.hooks = null;
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'client', 'index.html'), 'utf8'), '<html>v1</html>');
        assert.ok(fs.existsSync(path.join(s.dest, 'host', 'main.jsx')), 'obsolete file must be restored');
        assert.ok(!fs.existsSync(path.join(s.dest, 'host', 'new.jsx')));
        assert.strictEqual(s.ctx.receipts.get('test-tool', 'user').version, '1.0.0');
        assert.strictEqual(state(s, '1.0.0').state, 'installed');
    } finally { rmrf(s.root); }
});

test('a corrupt package is rejected before anything is written', async () => {
    const s = setup();
    try {
        const zip = makeToolZip(path.join(s.root, 'bad.vantyx'));
        const pkg = openPackage(zip);
        pkg.files[0].sha256 = 'f'.repeat(64);
        await assert.rejects(install(s.ctx, pkg), { code: 'PACKAGE_CORRUPT' });
        assert.ok(!fs.existsSync(s.dest));
    } finally { rmrf(s.root); }
});

test('installs from a ZIP package and enables CEP debug mode through the runner', async () => {
    const s = setup();
    try {
        const calls = [];
        s.ctx.env = { ...s.ctx.env, platform: 'win32' };
        s.ctx.runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: '', stderr: '' }; };
        const zip = makeToolZip(path.join(s.root, 'tool.vantyx'));
        const r = await install(s.ctx, openPackage(zip));
        assert.strictEqual(r.debugMode, 'enabled');
        assert.ok(calls.length >= 3);
        assert.deepStrictEqual(calls[0].slice(0, 6), ['reg', 'add', 'HKCU\\Software\\Adobe\\CSXS.9', '/v', 'PlayerDebugMode', '/t']);
        assert.ok(calls.every(c => c.includes('/f') && c.includes('PlayerDebugMode')));
    } finally { rmrf(s.root); }
});

test('a failing debug-mode step is a warning, not an install failure', async () => {
    const s = setup();
    try {
        s.ctx.env = { ...s.ctx.env, platform: 'win32' };
        s.ctx.runner = async () => ({ code: 1, stdout: '', stderr: 'access denied' });
        const r = await install(s.ctx, s.pkg());
        assert.strictEqual(r.debugMode, 'partial');
        assert.ok(r.warnings.length >= 1);
        assert.strictEqual(state(s, '1.0.0').state, 'installed');
    } finally { rmrf(s.root); }
});
