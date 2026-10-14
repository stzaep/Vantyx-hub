'use strict';
// Unsigned CEP extensions only load when HKCU\Software\Adobe\CSXS.<n>
// has PlayerDebugMode=1. We write it for every CSXS version that current and
// recent After Effects releases may use. Harmless if a key is not used.
const { execFile } = require('child_process');

const CSXS_VERSIONS = [9, 10, 11, 12, 13];

function defaultRunner(cmd, args) {
    return new Promise(resolve => {
        execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

const keyOf = v => 'HKCU\\Software\\Adobe\\CSXS.' + v;

async function enable(opts) {
    const o = opts || {};
    const platform = o.platform || process.platform;
    if (platform !== 'win32') return { skipped: true, set: [], errors: [] };
    const run = o.runner || defaultRunner;
    const set = [], errors = [];
    for (const v of (o.versions || CSXS_VERSIONS)) {
        const r = await run('reg', ['add', keyOf(v), '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
        if (r.code === 0) set.push(v); else errors.push({ version: v, message: (r.stderr || '').trim() });
    }
    return { skipped: false, set, errors };
}

async function status(opts) {
    const o = opts || {};
    const platform = o.platform || process.platform;
    if (platform !== 'win32') return { supported: false, enabled: [] };
    const run = o.runner || defaultRunner;
    const enabled = [];
    for (const v of (o.versions || CSXS_VERSIONS)) {
        const r = await run('reg', ['query', keyOf(v), '/v', 'PlayerDebugMode']);
        if (r.code === 0 && /PlayerDebugMode\s+REG_SZ\s+1\s*$/m.test(r.stdout)) enabled.push(v);
    }
    return { supported: true, enabled };
}

module.exports = { enable, status, CSXS_VERSIONS };
