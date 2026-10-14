'use strict';
// Guards the packages that ship with the app: if one is malformed the build
// should fail here, not on the user's machine.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { scanLibrary } = require('../src/core/library');
const { openPackage } = require('../src/core/package-reader');

const LIB = path.join(__dirname, '..', 'library');

test('every bundled package is valid and complete', () => {
    const lib = scanLibrary([LIB]);
    assert.deepStrictEqual(lib.problems, []);
    assert.ok(lib.byId.has('vantyx-organizer'));
    for (const entry of lib.byId.values()) {
        for (const v of entry.versions) {
            const pkg = openPackage(v.source);
            assert.ok(pkg.files.length > 0);
            assert.ok(!pkg.files.some(f => f.path === '.debug'), 'dev-only .debug file must not ship');
        }
    }
});

test('Organizer payload has the expected structure', () => {
    const pkg = openPackage(path.join(LIB, 'vantyx-organizer'));
    const paths = pkg.files.map(f => f.path);
    for (const p of ['CSXS/manifest.xml', 'client/index.html', 'host/vtx-main.jsx', 'host/modules/scan.jsx', 'host/modules/apply.jsx', 'host/modules/storage.jsx']) {
        assert.ok(paths.includes(p), 'missing ' + p);
    }
    const csxs = pkg.files.find(f => f.path === 'CSXS/manifest.xml').read().toString();
    assert.match(csxs, /ExtensionBundleId="com\.vantyx\.organizer"/);
    assert.match(csxs, /vtx-main\.jsx/, 'manifest must point at the renamed host script');
    // every script/css referenced by index.html must be in the payload
    const html = pkg.files.find(f => f.path === 'client/index.html').read().toString();
    for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) assert.ok(paths.includes('client/' + m[1]), 'index.html references missing ' + m[1]);
});
