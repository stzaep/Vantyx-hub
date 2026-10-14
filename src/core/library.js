'use strict';
// The library = every package found in the library folders (bundled with the
// app + user-imported). Each entry is a directory or a .vantyx/.zip file.
const fs = require('fs');
const path = require('path');
const { readManifest } = require('./package-reader');
const version = require('./version');

function scanLibrary(dirs) {
    const byId = new Map();
    const problems = [];
    for (const dir of dirs) {
        let names;
        try { names = fs.readdirSync(dir); } catch (e) { continue; }
        for (const name of names) {
            const full = path.join(dir, name);
            let st;
            try { st = fs.statSync(full); } catch (e) { continue; }
            if (!(st.isDirectory() || (st.isFile() && /\.(vantyx|zip)$/i.test(name)))) continue;
            try {
                const manifest = readManifest(full);
                const entry = byId.get(manifest.id) || { id: manifest.id, versions: [] };
                entry.versions.push({ version: manifest.version, manifest, source: full });
                byId.set(manifest.id, entry);
            } catch (e) {
                problems.push({ source: full, code: e.code || 'ERROR', message: e.message });
            }
        }
    }
    for (const entry of byId.values()) {
        entry.versions.sort((a, b) => version.compare(b.version, a.version));
        entry.latest = entry.versions[0];
    }
    return { byId, problems };
}

module.exports = { scanLibrary };
