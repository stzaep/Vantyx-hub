'use strict';
const RX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function isValid(v) { return RX.test(String(v)); }

function parse(v) {
    const m = RX.exec(String(v));
    if (!m) throw new Error('Invalid version: ' + v);
    return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null };
}

// -1 / 0 / 1. A pre-release (1.0.0-beta) is lower than its release.
function compare(a, b) {
    const pa = parse(a), pb = parse(b);
    for (let i = 0; i < 3; i++) {
        if (pa.n[i] !== pb.n[i]) return pa.n[i] < pb.n[i] ? -1 : 1;
    }
    if (pa.pre === pb.pre) return 0;
    if (!pa.pre) return 1;
    if (!pb.pre) return -1;
    return pa.pre < pb.pre ? -1 : 1;
}

module.exports = { isValid, compare };
