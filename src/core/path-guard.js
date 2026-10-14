'use strict';
// Every path the Hub reads, writes or deletes goes through this module.
const fs = require('fs');
const path = require('path');
const { HubError } = require('./errors');

const CASE_INSENSITIVE = process.platform === 'win32';
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/;

// Validates a relative path coming from a package/receipt and returns it
// normalized with forward slashes. Rejects absolute paths, drive letters,
// "..", Windows reserved names and illegal characters.
function safeRelative(rel) {
    if (typeof rel !== 'string' || !rel.length) throw new HubError('UNSAFE_PATH', 'Empty path');
    const s = rel.replace(/\\/g, '/');
    if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) throw new HubError('UNSAFE_PATH', 'Absolute path not allowed: ' + rel);
    const out = [];
    for (const seg of s.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') throw new HubError('UNSAFE_PATH', 'Path traversal not allowed: ' + rel);
        if (BAD_CHARS.test(seg) || RESERVED.test(seg) || /[. ]$/.test(seg)) {
            throw new HubError('UNSAFE_PATH', 'Illegal path segment "' + seg + '" in ' + rel);
        }
        out.push(seg);
    }
    if (!out.length) throw new HubError('UNSAFE_PATH', 'Empty path');
    return out.join('/');
}

function norm(p) {
    const n = path.resolve(p);
    return CASE_INSENSITIVE ? n.toLowerCase() : n;
}

// true only if target is strictly below root (root itself does not count).
function isInside(root, target) {
    const r = norm(root), t = norm(target);
    if (r === t) return false;
    const rel = path.relative(r, t);
    return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function samePath(a, b) { return norm(a) === norm(b); }

function resolveInside(root, rel) {
    const clean = safeRelative(rel);
    const full = path.resolve(root, ...clean.split('/'));
    if (!isInside(root, full)) throw new HubError('UNSAFE_PATH', 'Path escapes its root: ' + rel);
    return full;
}

// Refuses to operate through symlinks / junctions between root and target.
function assertNoLinks(root, full) {
    const base = path.resolve(root);
    const rel = path.relative(base, path.resolve(full));
    let cur = base;
    for (const seg of rel.split(path.sep).filter(Boolean)) {
        cur = path.join(cur, seg);
        let st;
        try { st = fs.lstatSync(cur); } catch (e) {
            if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return;
            throw e;
        }
        if (st.isSymbolicLink()) throw new HubError('SYMLINK_BLOCKED', 'Symbolic link blocked: ' + cur);
    }
}

// Expands %VAR% using the given map (case-insensitive names).
function expandEnv(str, vars) {
    return String(str).replace(/%([^%]+)%/g, (m, name) => {
        const key = Object.keys(vars).find(k => k.toLowerCase() === name.toLowerCase());
        if (!key || !vars[key]) throw new HubError('UNSAFE_PATH', 'Unknown variable ' + m);
        return vars[key];
    });
}

module.exports = { safeRelative, isInside, samePath, resolveInside, assertNoLinks, expandEnv };
