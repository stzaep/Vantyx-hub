'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { openPackage, readManifest, validateManifest } = require('../src/core/package-reader');
const { tmp, rmrf, makeToolDir, makeToolZip, toolFiles, manifestOf, makeZip } = require('./helpers');

test('manifest validation reports every problem', () => {
    assert.throws(() => validateManifest({ id: 'X', version: '1', kind: 'nope' }), e => {
        assert.strictEqual(e.code, 'MANIFEST_INVALID');
        assert.ok(e.details.problems.length >= 4);
        return true;
    });
    assert.throws(() => validateManifest(manifestOf({ payload: '../x' })), { code: 'MANIFEST_INVALID' });
    assert.throws(() => validateManifest(manifestOf({ installDir: 'a/b' })), { code: 'MANIFEST_INVALID' });
    assert.throws(() => validateManifest(manifestOf({ userData: 'x' })), { code: 'MANIFEST_INVALID' });
    const m = validateManifest(manifestOf());
    assert.strictEqual(m.installDir, 'TestTool');
    assert.strictEqual(m.cep.requiresDebugMode, true);
});

test('directory and ZIP packages produce identical file lists and hashes', () => {
    const d = tmp();
    try {
        makeToolDir(path.join(d, 'dir'));
        makeToolZip(path.join(d, 'pkg.vantyx'));
        const a = openPackage(path.join(d, 'dir')), b = openPackage(path.join(d, 'pkg.vantyx'));
        const norm = p => p.files.map(f => f.path + ':' + f.sha256).sort();
        assert.deepStrictEqual(norm(a), norm(b));
        assert.strictEqual(a.files.length, 3);
        assert.strictEqual(readManifest(path.join(d, 'pkg.vantyx')).id, 'test-tool');
    } finally { rmrf(d); }
});

test('rejects a CEP payload without CSXS/manifest.xml', () => {
    const d = tmp();
    try {
        makeToolDir(path.join(d, 'dir'), { files: toolFiles({ 'CSXS/manifest.xml': null }) });
        assert.throws(() => openPackage(path.join(d, 'dir')), { code: 'PAYLOAD_INVALID' });
    } finally { rmrf(d); }
});

test('missing manifest / invalid JSON / missing package give clear errors', () => {
    const d = tmp();
    try {
        makeZip(path.join(d, 'nomanifest.zip'), [{ name: 'payload/a.txt', data: 'x' }]);
        assert.throws(() => openPackage(path.join(d, 'nomanifest.zip')), { code: 'MANIFEST_MISSING' });
        makeZip(path.join(d, 'badjson.zip'), [{ name: 'vantyx.json', data: '{nope' }]);
        assert.throws(() => openPackage(path.join(d, 'badjson.zip')), { code: 'MANIFEST_INVALID' });
        assert.throws(() => openPackage(path.join(d, 'missing.zip')), { code: 'PACKAGE_NOT_FOUND' });
    } finally { rmrf(d); }
});
