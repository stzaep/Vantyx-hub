'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { install } = require('../src/core/installer');
const { uninstall, checkUserDataPath } = require('../src/core/uninstaller');
const { openPackage } = require('../src/core/package-reader');
const { tmp, rmrf, makeToolDir, makeCtx } = require('./helpers');

async function setup(manifest) {
    const root = tmp();
    const ctx = makeCtx(root);
    const pkg = openPackage(makeToolDir(path.join(root, 'pkg'), { manifest }));
    await install(ctx, pkg);
    const extRoot = path.join(ctx.env.appData, 'Adobe', 'CEP', 'extensions');
    return { root, ctx, extRoot, dest: path.join(extRoot, 'TestTool'), userData: path.join(ctx.env.appData, 'VantyxTest') };
}

test('uninstall removes exactly the recorded files and the folder', async () => {
    const s = await setup();
    try {
        const r = uninstall(s.ctx, 'test-tool');
        assert.strictEqual(r.removed, 3);
        assert.ok(!fs.existsSync(s.dest));
        assert.strictEqual(s.ctx.receipts.list().length, 0);
    } finally { rmrf(s.root); }
});

test('foreign files and sibling extensions are never touched', async () => {
    const s = await setup();
    try {
        fs.writeFileSync(path.join(s.dest, 'user-notes.txt'), 'mine');
        fs.mkdirSync(path.join(s.dest, 'client', 'mine'), { recursive: true });
        fs.writeFileSync(path.join(s.dest, 'client', 'mine', 'x.txt'), 'keep');
        const other = path.join(s.extRoot, 'OtherVendorExt');
        fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'a.txt'), 'other');

        const r = uninstall(s.ctx, 'test-tool');
        assert.strictEqual(r.removed, 3);
        assert.ok(r.leftover.includes('user-notes.txt'));
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'user-notes.txt'), 'utf8'), 'mine');
        assert.strictEqual(fs.readFileSync(path.join(s.dest, 'client', 'mine', 'x.txt'), 'utf8'), 'keep');
        assert.strictEqual(fs.readFileSync(path.join(other, 'a.txt'), 'utf8'), 'other');
        assert.ok(!fs.existsSync(path.join(s.dest, 'CSXS')), 'empty folders created by the install are removed');
    } finally { rmrf(s.root); }
});

test('user data is kept by default and removed only when requested', async () => {
    const s = await setup();
    try {
        fs.mkdirSync(s.userData, { recursive: true });
        fs.writeFileSync(path.join(s.userData, 'config.json'), '{}');

        const r = uninstall(s.ctx, 'test-tool');
        assert.deepStrictEqual(r.userDataKept, [s.userData]);
        assert.ok(fs.existsSync(path.join(s.userData, 'config.json')));

        const s2 = await setup();
        try {
            fs.mkdirSync(s2.userData, { recursive: true });
            fs.writeFileSync(path.join(s2.userData, 'config.json'), '{}');
            const r2 = uninstall(s2.ctx, 'test-tool', { removeUserData: true });
            assert.deepStrictEqual(r2.userDataRemoved, [s2.userData]);
            assert.ok(!fs.existsSync(s2.userData));
        } finally { rmrf(s2.root); }
    } finally { rmrf(s.root); }
});

test('user-data deletion is refused outside AppData or for non-Vantyx folders', async () => {
    const s = await setup();
    try {
        const env = s.ctx.env;
        assert.throws(() => checkUserDataPath(env, '%APPDATA%'), { code: 'USERDATA_PATH_REFUSED' });                // the root itself
        assert.throws(() => checkUserDataPath(env, '%APPDATA%/Adobe'), { code: 'USERDATA_PATH_REFUSED' });          // not Vantyx-named
        assert.throws(() => checkUserDataPath(env, '%USERPROFILE%/Documents/Vantyx'), { code: 'USERDATA_PATH_REFUSED' }); // outside AppData
        assert.throws(() => checkUserDataPath(env, '%APPDATA%/../Vantyx'), { code: 'USERDATA_PATH_REFUSED' });      // traversal
        assert.doesNotThrow(() => checkUserDataPath(env, '%APPDATA%/VantyxOrganizer'));
        assert.doesNotThrow(() => checkUserDataPath(env, '%LOCALAPPDATA%/Vantyx/Cache'));

        // A manifest asking to delete Adobe's folder must not delete it.
        const bad = await setup({ userData: ['%APPDATA%/Adobe'] });
        try {
            const adobe = path.join(bad.ctx.env.appData, 'Adobe');
            const r = uninstall(bad.ctx, 'test-tool', { removeUserData: true });
            assert.ok(fs.existsSync(adobe));
            assert.strictEqual(r.userDataRemoved.length, 0);
            assert.ok(r.warnings.length >= 1);
        } finally { rmrf(bad.root); }
    } finally { rmrf(s.root); }
});

test('a tampered receipt cannot make the uninstaller delete outside the install folder', async () => {
    const s = await setup();
    try {
        const victim = path.join(s.root, 'victim.txt');
        fs.writeFileSync(victim, 'precious');
        const rec = s.ctx.receipts.get('test-tool', 'user');
        rec.files.push({ path: '../../../../../victim.txt', sha256: 'x', size: 1 });
        s.ctx.receipts.put(rec);
        assert.throws(() => uninstall(s.ctx, 'test-tool'), { code: 'UNSAFE_PATH' });
        assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'precious');
        assert.ok(fs.existsSync(path.join(s.dest, 'CSXS', 'manifest.xml')), 'nothing was deleted');

        const rec2 = s.ctx.receipts.get('test-tool', 'user');
        rec2.files.pop(); rec2.targetRoot = s.root;
        s.ctx.receipts.put(rec2);
        assert.throws(() => uninstall(s.ctx, 'test-tool'), { code: 'RECEIPT_ROOT_MISMATCH' });
        assert.ok(fs.existsSync(path.join(s.dest, 'CSXS', 'manifest.xml')));
    } finally { rmrf(s.root); }
});

test('tools not installed by the Hub cannot be uninstalled', async () => {
    const s = await setup();
    try {
        assert.throws(() => uninstall(s.ctx, 'something-else'), { code: 'NOT_MANAGED' });
    } finally { rmrf(s.root); }
});

test('uninstall works on an incomplete install (files already missing)', async () => {
    const s = await setup();
    try {
        fs.unlinkSync(path.join(s.dest, 'host', 'main.jsx'));
        const r = uninstall(s.ctx, 'test-tool');
        assert.strictEqual(r.removed, 2);
        assert.ok(!fs.existsSync(s.dest));
        assert.strictEqual(s.ctx.receipts.list().length, 0);
    } finally { rmrf(s.root); }
});

test('if a file cannot be removed the receipt keeps it so the user can retry', async () => {
    const s = await setup();
    try {
        const stuck = path.join(s.dest, 'host', 'main.jsx');
        fs.unlinkSync(stuck); fs.mkdirSync(stuck);               // a directory where a file should be -> cannot unlink
        const r = uninstall(s.ctx, 'test-tool');
        assert.strictEqual(r.partial, true);
        const rec = s.ctx.receipts.get('test-tool', 'user');
        assert.deepStrictEqual(rec.files.map(f => f.path), ['host/main.jsx']);
    } finally { rmrf(s.root); }
});
