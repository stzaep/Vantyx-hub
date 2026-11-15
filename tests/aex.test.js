'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tmp, rmrf, makeEnv } = require('./helpers');
const { detectAfterEffects } = require('../src/core/ae-detect');
const { installAll, uninstallAll } = require('../src/core/aex-installer');
const { ReceiptStore } = require('../src/core/receipts');

function makeAes(env) {
    for (const name of ['Adobe After Effects 2024', 'Adobe After Effects 2025', 'Adobe After Effects (Beta)']) {
        const support = path.join(env.programFiles, 'Adobe', name, 'Support Files');
        fs.mkdirSync(support, { recursive: true });
        fs.writeFileSync(path.join(support, 'AfterFX.exe'), '');
    }
}

function makeCtx(root, env) {
    const dataDir = path.join(root, 'data');
    return {
        env, dataDir, receipts: new ReceiptStore(dataDir),
        elevate: async ({ operations }) => {
            for (const op of operations) {
                if (op.action === 'install') {
                    fs.mkdirSync(path.dirname(op.destination), { recursive: true });
                    fs.copyFileSync(op.source, op.destination);
                    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(op.destination)).digest('hex'), op.sha256);
                } else if (op.action === 'uninstall') {
                    if (fs.existsSync(op.destination)) {
                        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(op.destination)).digest('hex'), op.sha256);
                        fs.unlinkSync(op.destination);
                    }
                }
            }
        }
    };
}

test('After Effects detector exposes Plug-ins/Vantyx destinations', () => {
    const root = tmp();
    try {
        const env = makeEnv(root, { platform: 'win32' });
        makeAes(env);
        const found = detectAfterEffects(env);
        assert.equal(found.length, 3);
        assert.ok(found.every(a => a.vantyxPlugInsDir.endsWith(path.join('Plug-ins', 'Vantyx'))));
    } finally { rmrf(root); }
});

test('VTX Console installs to every detected AE version and uninstalls only its own file', async () => {
    const root = tmp();
    try {
        const env = makeEnv(root, { platform: 'win32' });
        makeAes(env);
        const ctx = makeCtx(root, env);
        const bytes = Buffer.from('fake-native-aex-binary');
        const pkg = { manifest: { id: 'vtx-console', name: 'VTX Console', kind: 'aex', version: '1.0.0' }, files: [{ path: 'VTX-Console.aex', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), read: () => bytes }] };
        const result = await installAll(ctx, pkg, {});
        assert.equal(result.action, 'installed');
        assert.equal(result.written, 3);
        assert.equal(ctx.receipts.list().filter(r => r.id === 'vtx-console').length, 3);
        for (const ae of detectAfterEffects(env)) {
            assert.equal(fs.readFileSync(path.join(ae.vantyxPlugInsDir, 'VTX-Console.aex')).toString(), bytes.toString());
        }
        const again = await installAll(ctx, pkg, {});
        assert.equal(again.action, 'already-installed');
        const removed = await uninstallAll(ctx, 'vtx-console');
        assert.equal(removed.removed, 3);
        assert.equal(ctx.receipts.list().filter(r => r.id === 'vtx-console').length, 0);
        for (const ae of detectAfterEffects(env)) assert.equal(fs.existsSync(path.join(ae.vantyxPlugInsDir, 'VTX-Console.aex')), false);
    } finally { rmrf(root); }
});

test('Hub exposes VTX Console as one library item with aggregate state across AE versions', async () => {
    const root = tmp();
    try {
        const env = makeEnv(root, { platform: 'win32' });
        makeAes(env);
        const library = path.join(root, 'library');
        const pkgDir = path.join(library, 'vtx-console');
        fs.mkdirSync(path.join(pkgDir, 'payload'), { recursive: true });
        const bytes = Buffer.from('test-aex');
        fs.writeFileSync(path.join(pkgDir, 'vantyx.json'), JSON.stringify({ id: 'vtx-console', name: 'VTX Console', version: '1.0.0', kind: 'aex', payload: 'payload', installDir: 'Vantyx' }));
        fs.writeFileSync(path.join(pkgDir, 'payload', 'VTX-Console.aex'), bytes);
        const { createHub } = require('../src/core/hub');
        const ctx = makeCtx(root, env);
        const hub = createHub({ env, dataDir: ctx.dataDir, libraryDirs: [library], elevate: ctx.elevate });
        let listed = await hub.listTools();
        assert.equal(listed.tools.length, 1);
        assert.equal(listed.tools[0].kind, 'aex');
        assert.equal(listed.tools[0].targets[0].state, 'not-installed');
        await hub.installTool('vtx-console');
        listed = await hub.listTools();
        assert.equal(listed.tools[0].targets[0].state, 'installed');
        assert.equal(listed.tools[0].targets[0].detectedVersions.length, 3);
        await hub.uninstallTool('vtx-console');
        listed = await hub.listTools();
        assert.equal(listed.tools[0].targets[0].state, 'not-installed');
    } finally { rmrf(root); }
});
