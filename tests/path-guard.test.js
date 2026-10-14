'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const g = require('../src/core/path-guard');
const { tmp, rmrf } = require('./helpers');

test('safeRelative accepts normal paths and normalizes separators', () => {
    assert.strictEqual(g.safeRelative('a/b/c.txt'), 'a/b/c.txt');
    assert.strictEqual(g.safeRelative('a\\b\\c.txt'), 'a/b/c.txt');
    assert.strictEqual(g.safeRelative('./a//b'), 'a/b');
});

test('safeRelative rejects traversal, absolute paths, drives and illegal names', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', '\\windows', 'C:\\x', 'c:/x', '', 'a/b:stream', 'CON', 'a/nul.txt', 'a/b?', 'a/trail.', 'a/sp ', 'a\u0000b']) {
        assert.throws(() => g.safeRelative(bad), { code: 'UNSAFE_PATH' }, 'should reject ' + JSON.stringify(bad));
    }
});

test('isInside is strict: the root itself and siblings are outside', () => {
    assert.ok(g.isInside('/a/b', '/a/b/c'));
    assert.ok(!g.isInside('/a/b', '/a/b'));
    assert.ok(!g.isInside('/a/b', '/a/bc'));
    assert.ok(!g.isInside('/a/b', '/a'));
    assert.ok(!g.isInside('/a/b', '/a/b/../x'));
});

test('resolveInside stays inside the root', () => {
    assert.strictEqual(g.resolveInside('/r', 'x/y'), path.resolve('/r/x/y'));
    assert.throws(() => g.resolveInside('/r', '../out'), { code: 'UNSAFE_PATH' });
});

test('expandEnv expands known variables and rejects unknown ones', () => {
    assert.strictEqual(g.expandEnv('%APPDATA%/X', { APPDATA: '/home/u' }), '/home/u/X');
    assert.strictEqual(g.expandEnv('%appdata%/X', { APPDATA: '/home/u' }), '/home/u/X');
    assert.throws(() => g.expandEnv('%NOPE%/X', { APPDATA: '/a' }), { code: 'UNSAFE_PATH' });
});

test('assertNoLinks blocks symlinks inside the path', t => {
    const root = tmp();
    try {
        fs.mkdirSync(path.join(root, 'real'));
        try { fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link')); } catch (e) { return t.skip('symlinks not available'); }
        assert.throws(() => g.assertNoLinks(root, path.join(root, 'link', 'file.txt')), { code: 'SYMLINK_BLOCKED' });
        assert.doesNotThrow(() => g.assertNoLinks(root, path.join(root, 'real', 'file.txt')));
    } finally { rmrf(root); }
});
