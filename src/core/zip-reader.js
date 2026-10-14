'use strict';
// Minimal, dependency-free ZIP reader (stored + deflate, no ZIP64, no
// encryption). Every entry name is validated (zip-slip) and every entry is
// CRC-checked on read. Size limits protect against zip bombs.
const fs = require('fs');
const zlib = require('zlib');
const { HubError } = require('./errors');
const { safeRelative } = require('./path-guard');

const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const DEFAULT_LIMITS = { maxFile: 300e6, maxEntries: 5000, maxTotal: 500e6, maxEntry: 200e6, maxRatio: 1000 };

function invalid(msg) { return new HubError('ZIP_INVALID', msg); }

function openZip(file, limits) {
    const L = Object.assign({}, DEFAULT_LIMITS, limits || {});
    const st = fs.statSync(file);
    if (st.size > L.maxFile) throw new HubError('ZIP_TOO_LARGE', 'ZIP file is too large');
    const buf = fs.readFileSync(file);
    if (buf.length < 22) throw invalid('Not a valid ZIP file');

    let eocd = -1;
    const min = Math.max(0, buf.length - 22 - 0xFFFF);
    for (let i = buf.length - 22; i >= min; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw invalid('Not a valid ZIP file');

    const total = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new HubError('ZIP_UNSUPPORTED', 'ZIP64 is not supported');
    if (total > L.maxEntries) throw new HubError('ZIP_TOO_LARGE', 'Too many entries in ZIP');
    if (cdOff + cdSize > buf.length) throw invalid('Corrupt central directory');

    const entries = [];
    const seen = new Set();
    let p = cdOff, totalSize = 0;

    for (let n = 0; n < total; n++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw invalid('Corrupt central directory');
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const csize = buf.readUInt32LE(p + 20);
        const usize = buf.readUInt32LE(p + 24);
        const nlen = buf.readUInt16LE(p + 28);
        const elen = buf.readUInt16LE(p + 30);
        const clen = buf.readUInt16LE(p + 32);
        const lho = buf.readUInt32LE(p + 42);
        const rawName = buf.toString('utf8', p + 46, p + 46 + nlen);
        p += 46 + nlen + elen + clen;

        const trimmed = rawName.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!trimmed || trimmed === '.') continue;
        const isDir = /[\\/]$/.test(rawName);

        let name;
        try { name = safeRelative(trimmed); }
        catch (e) { throw new HubError('ZIP_UNSAFE_PATH', 'Unsafe path inside ZIP: ' + rawName); }

        if (flags & 1) throw new HubError('ZIP_UNSUPPORTED', 'Encrypted ZIPs are not supported');
        const lower = name.toLowerCase();
        if (seen.has(lower)) throw invalid('Duplicate entry in ZIP: ' + name);
        seen.add(lower);
        if (isDir) continue;

        if (method !== 0 && method !== 8) throw new HubError('ZIP_UNSUPPORTED', 'Unsupported compression method for ' + name);
        if (usize > L.maxEntry) throw new HubError('ZIP_TOO_LARGE', 'Entry too large: ' + name);
        totalSize += usize;
        if (totalSize > L.maxTotal) throw new HubError('ZIP_TOO_LARGE', 'ZIP expands to too much data');
        if (usize > 1e6 && csize > 0 && usize / csize > L.maxRatio) throw new HubError('ZIP_TOO_LARGE', 'Suspicious compression ratio: ' + name);

        entries.push({
            path: name,
            size: usize,
            read: function () { return readEntry(buf, { name, method, crc, csize, usize, lho }); }
        });
    }
    return { entries };
}

function readEntry(buf, e) {
    const o = e.lho;
    if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new HubError('ZIP_CORRUPT', 'Corrupt entry: ' + e.name);
    const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
    const end = start + e.csize;
    if (end > buf.length) throw new HubError('ZIP_CORRUPT', 'Truncated entry: ' + e.name);
    const data = buf.subarray(start, end);
    let out;
    try {
        out = e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data, { maxOutputLength: e.usize + 1 });
    } catch (err) { throw new HubError('ZIP_CORRUPT', 'Cannot decompress ' + e.name); }
    if (out.length !== e.usize || crc32(out) !== e.crc) throw new HubError('ZIP_CORRUPT', 'Checksum mismatch: ' + e.name);
    return out;
}

module.exports = { openZip, crc32 };
