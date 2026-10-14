'use strict';
// Compares a receipt with what is really on disk.
//   not-installed | unmanaged | installed | outdated | incomplete | modified
const fs = require('fs');
const crypto = require('crypto');
const { resolveInside, assertNoLinks } = require('./path-guard');
const version = require('./version');

function inspectInstall({ receipt, installRoot, pkgVersion }) {
    if (!receipt) {
        return { state: fs.existsSync(installRoot) ? 'unmanaged' : 'not-installed', missing: [], modified: [], installedVersion: null };
    }
    const missing = [], modified = [];
    for (const f of receipt.files) {
        const full = resolveInside(installRoot, f.path);   // throws if the receipt was tampered with
        assertNoLinks(installRoot, full);
        let st;
        try { st = fs.lstatSync(full); } catch (e) { missing.push(f.path); continue; }
        if (!st.isFile()) { missing.push(f.path); continue; }
        const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        if (h !== f.sha256) modified.push(f.path);
    }
    let state = 'installed';
    if (missing.length) state = 'incomplete';
    else if (pkgVersion && version.compare(pkgVersion, receipt.version) > 0) state = 'outdated';
    else if (modified.length) state = 'modified';
    return { state, missing, modified, installedVersion: receipt.version };
}

module.exports = { inspectInstall };
