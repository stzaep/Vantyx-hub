'use strict';
// A tool package is either a directory or a ZIP (.vantyx / .zip) containing
// `vantyx.json` plus a payload folder. See docs/package-format.md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HubError } = require('./errors');
const { safeRelative } = require('./path-guard');
const { openZip } = require('./zip-reader');
const version = require('./version');
const kinds = require('../kinds');

const MANIFEST = 'vantyx.json';
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function validateManifest(raw) {
    const problems = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new HubError('MANIFEST_INVALID', 'vantyx.json must be a JSON object');
    }
    const str = (k, max) => typeof raw[k] === 'string' && raw[k].trim().length > 0 && raw[k].length <= max;

    if (!(typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(raw.id))) problems.push('"id" must match [a-z0-9-], 2-63 chars');
    if (!str('name', 80)) problems.push('"name" is required (max 80 chars)');
    if (!version.isValid(raw.version)) problems.push('"version" must look like 1.2.3');
    if (!kinds.has(raw.kind)) problems.push('"kind" must be one of: ' + kinds.ids().join(', '));
    if (raw.description !== undefined && typeof raw.description !== 'string') problems.push('"description" must be a string');
    if (raw.author !== undefined && typeof raw.author !== 'string') problems.push('"author" must be a string');

    let payload = 'payload';
    if (raw.payload !== undefined) {
        try { payload = safeRelative(raw.payload); } catch (e) { problems.push('"payload" is not a safe relative path'); }
    }
    let installDir = payload.split('/').pop();
    if (raw.installDir !== undefined) {
        if (typeof raw.installDir === 'string' && !/[\\/]/.test(raw.installDir)) {
            try { installDir = safeRelative(raw.installDir); } catch (e) { problems.push('"installDir" is not a safe folder name'); }
        } else problems.push('"installDir" must be a single folder name');
    }
    let userData = [];
    if (raw.userData !== undefined) {
        if (Array.isArray(raw.userData) && raw.userData.length <= 10 && raw.userData.every(s => typeof s === 'string' && s.length > 0 && s.length < 300)) userData = raw.userData.slice();
        else problems.push('"userData" must be an array of up to 10 path strings');
    }

    let extra = {};
    if (kinds.has(raw.kind)) extra = kinds.get(raw.kind).validateManifest(raw, problems) || {};
    if (problems.length) throw new HubError('MANIFEST_INVALID', problems.join('; '), { problems });

    return Object.assign({
        id: raw.id,
        name: raw.name.trim(),
        version: raw.version,
        kind: raw.kind,
        description: raw.description || '',
        author: raw.author || '',
        payload, installDir, userData,
        requires: raw.requires && typeof raw.requires === 'object' ? raw.requires : {}
    }, extra);
}

function walkDir(root) {
    const out = [];
    (function rec(dir) {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const st = fs.lstatSync(full);
            if (st.isSymbolicLink()) throw new HubError('PACKAGE_UNSAFE', 'Symbolic links are not allowed in packages: ' + full);
            if (st.isDirectory()) rec(full);
            else if (st.isFile()) {
                out.push({ path: path.relative(root, full).split(path.sep).join('/'), size: st.size, read: () => fs.readFileSync(full) });
            }
        }
    })(root);
    return out;
}

// source: { manifestBuffer(), files() -> [{path,size,read}] }
function openSource(sourcePath) {
    let st;
    try { st = fs.statSync(sourcePath); } catch (e) { throw new HubError('PACKAGE_NOT_FOUND', 'Package not found: ' + sourcePath); }
    if (st.isDirectory()) {
        const mf = path.join(sourcePath, MANIFEST);
        return {
            type: 'dir',
            manifestBuffer() {
                try {
                    if (fs.lstatSync(mf).isSymbolicLink()) throw new Error('link');
                    return fs.readFileSync(mf);
                } catch (e) { throw new HubError('MANIFEST_MISSING', MANIFEST + ' not found in package'); }
            },
            files: () => walkDir(sourcePath)
        };
    }
    let zip = null;
    const get = () => zip || (zip = openZip(sourcePath));
    return {
        type: 'zip',
        manifestBuffer() {
            const e = get().entries.find(x => x.path === MANIFEST);
            if (!e) throw new HubError('MANIFEST_MISSING', MANIFEST + ' not found at the root of the ZIP');
            return e.read();
        },
        files: () => get().entries
    };
}

function parseManifest(buf) {
    let raw;
    try { raw = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new HubError('MANIFEST_INVALID', 'vantyx.json is not valid JSON'); }
    return validateManifest(raw);
}

// Fast: only reads and validates the manifest.
function readManifest(sourcePath) {
    return parseManifest(openSource(sourcePath).manifestBuffer());
}

// Full: lists payload files with sha256 and validates the payload.
function openPackage(sourcePath) {
    const src = openSource(sourcePath);
    const manifest = parseManifest(src.manifestBuffer());
    const prefix = manifest.payload + '/';
    const files = [];
    for (const f of src.files()) {
        if (!f.path.startsWith(prefix)) continue;
        const rel = f.path.slice(prefix.length);
        if (!rel) continue;
        const data = f.read();
        files.push({ path: safeRelative(rel), size: data.length, sha256: sha256(data), read: f.read });
    }
    if (!files.length) throw new HubError('PAYLOAD_INVALID', 'Payload folder "' + manifest.payload + '" is empty or missing');
    kinds.get(manifest.kind).validatePayload(files);
    return { manifest, files, source: { type: src.type, path: sourcePath } };
}

module.exports = { readManifest, openPackage, validateManifest, sha256, MANIFEST };
