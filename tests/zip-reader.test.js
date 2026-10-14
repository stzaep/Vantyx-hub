'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openZip } = require('../src/core/zip-reader');
const { tmp, rmrf, makeZip } = require('./helpers');

test('reads stored and deflated entries', () => {
    const d = tmp();
    try {
        const f = path.join(d, 'a.zip');
        makeZip(f, [{ name: 'a.txt', data: 'hello', method: 0 }, { name: 'dir/b.txt', data: 'x'.repeat(5000) }]);
        const { entries } = openZip(f);
        assert.deepStrictEqual(entries.map(e => e.path), ['a.txt', 'dir/b.txt']);
        assert.strictEqual(entries[0].read().toString(), 'hello');
        assert.strictEqual(entries[1].read().length, 5000);
    } finally { rmrf(d); }
});

test('reads a ZIP made by Info-ZIP (interoperability)', t => {
    const d = tmp();
    try {
        fs.mkdirSync(path.join(d, 'src/sub'), { recursive: true });
        fs.writeFileSync(path.join(d, 'src/sub/f.txt'), 'interop');
        fs.writeFileSync(path.join(d, 'src/g.txt'), 'g'.repeat(3000));
        try { execFileSync('zip', ['-qr', path.join(d, 'x.zip'), '.'], { cwd: path.join(d, 'src') }); } catch (e) { return t.skip('zip CLI not available'); }
        const { entries } = openZip(path.join(d, 'x.zip'));
        const m = Object.fromEntries(entries.map(e => [e.path, e.read().toString()]));
        assert.strictEqual(m['sub/f.txt'], 'interop');
        assert.strictEqual(m['g.txt'].length, 3000);
    } finally { rmrf(d); }
});

test('rejects zip-slip entries', () => {
    const d = tmp();
    try {
        for (const name of ['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:/evil.txt', '..\\evil.txt']) {
            const f = path.join(d, 'bad.zip');
            makeZip(f, [{ name, data: 'x' }]);
            assert.throws(() => openZip(f), { code: 'ZIP_UNSAFE_PATH' }, name);
        }
    } finally { rmrf(d); }
});

test('detects corrupt data (bad CRC)', () => {
    const d = tmp();
    try {
        const f = path.join(d, 'c.zip');
        makeZip(f, [{ name: 'a.txt', data: 'hello', badCrc: true }]);
        const { entries } = openZip(f);
        assert.throws(() => entries[0].read(), { code: 'ZIP_CORRUPT' });
    } finally { rmrf(d); }
});

test('rejects encrypted entries, duplicates, garbage and truncated files', () => {
    const d = tmp();
    try {
        const f = path.join(d, 'e.zip');
        makeZip(f, [{ name: 'a.txt', data: 'x', flags: 1 }]);
        assert.throws(() => openZip(f), { code: 'ZIP_UNSUPPORTED' });
        makeZip(f, [{ name: 'a.txt', data: 'x' }, { name: 'A.TXT', data: 'y' }]);
        assert.throws(() => openZip(f), { code: 'ZIP_INVALID' });
        fs.writeFileSync(f, 'this is not a zip file at all, just text');
        assert.throws(() => openZip(f), { code: 'ZIP_INVALID' });
        makeZip(f, [{ name: 'a.txt', data: 'hello world'.repeat(100) }]);
        const buf = fs.readFileSync(f);
        fs.writeFileSync(f, buf.subarray(0, buf.length - 30));
        assert.throws(() => openZip(f), { code: 'ZIP_INVALID' });
    } finally { rmrf(d); }
});

test('enforces size limits (zip bomb protection)', () => {
    const d = tmp();
    try {
        const f = path.join(d, 'b.zip');
        makeZip(f, [{ name: 'big.bin', data: Buffer.alloc(3e6) }]);
        assert.throws(() => openZip(f, { maxEntry: 1e6 }), { code: 'ZIP_TOO_LARGE' });
        assert.throws(() => openZip(f), { code: 'ZIP_TOO_LARGE' });   // ratio of zeros is > 1000
    } finally { rmrf(d); }
});
