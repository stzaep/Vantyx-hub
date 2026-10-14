'use strict';
// Finds installed After Effects versions: <ProgramFiles>\Adobe\Adobe After Effects <label>\Support Files\AfterFX.exe
const fs = require('fs');
const path = require('path');

function detectAfterEffects(env) {
    const roots = Array.from(new Set([env.programFiles, env.programFilesX86].filter(Boolean)));
    const found = [];
    for (const root of roots) {
        const adobe = path.join(root, 'Adobe');
        let names;
        try { names = fs.readdirSync(adobe); } catch (e) { continue; }
        for (const name of names) {
            const m = /^Adobe After Effects (.+)$/i.exec(name);
            if (!m) continue;
            const dir = path.join(adobe, name);
            const exe = path.join(dir, 'Support Files', 'AfterFX.exe');
            if (!fs.existsSync(exe)) continue;
            const scripts = path.join(dir, 'Support Files', 'Scripts');
            found.push({
                name, label: m[1], dir, exe,
                scriptsDir: scripts,
                scriptUiPanelsDir: path.join(scripts, 'ScriptUI Panels'),
                beta: /beta/i.test(m[1])
            });
        }
    }
    return found.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
}

module.exports = { detectAfterEffects };
