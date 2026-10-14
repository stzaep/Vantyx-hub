'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('../src/core/zip-reader');
const { getEnv } = require('../src/core/env');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-test-'));
const rmrf = p => fs.rmSync(p, { recursive: true, force: true });

// Tiny ZIP writer for fixtures. entry: { name, data, method=8, flags=0, badCrc=false }
function makeZip(file, entries) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8');
        const data = Buffer.from(e.data || '');
        const method = e.method === undefined ? 8 : e.method;
        const comp = method === 8 ? zlib.deflateRawSync(data) : data;
        const crc = e.badCrc ? (crc32(data) ^ 0xFFFF) >>> 0 : crc32(data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags || 0, 6);
        lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
        lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags || 0, 8);
        ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
        ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
        locals.push(lh, name, comp);
        centrals.push(ch, name);
        offset += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
}

const CSXS = '<?xml version="1.0"?>\n<ExtensionManifest ExtensionBundleId="com.test.tool" Version="7.0"></ExtensionManifest>\n';

function toolFiles(extra) {
    return Object.assign({
        'CSXS/manifest.xml': CSXS,
        'client/index.html': '<html>v1</html>',
        'host/main.jsx': '// host'
    }, extra || {});
}

function manifestOf(over) {
    return Object.assign({
        id: 'test-tool', name: 'Test Tool', version: '1.0.0', kind: 'cep',
        payload: 'payload', installDir: 'TestTool', userData: ['%APPDATA%/VantyxTest']
    }, over || {});
}

// Directory package
function makeToolDir(dir, opts) {
    const o = opts || {};
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'vantyx.json'), JSON.stringify(manifestOf(o.manifest)));
    const files = o.files || toolFiles();
    for (const [rel, text] of Object.entries(files)) {
        if (text === null) continue;
        const full = path.join(dir, 'payload', rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return dir;
}

// ZIP package equivalent of makeToolDir
function makeToolZip(file, opts) {
    const o = opts || {};
    const entries = [{ name: 'vantyx.json', data: JSON.stringify(manifestOf(o.manifest)) }];
    for (const [rel, text] of Object.entries(o.files || toolFiles())) entries.push({ name: 'payload/' + rel, data: text });
    makeZip(file, entries);
    return file;
}

function makeEnv(root, over) {
    return getEnv(Object.assign({
        platform: 'linux',
        home: path.join(root, 'home'),
        appData: path.join(root, 'AppData', 'Roaming'),
        localAppData: path.join(root, 'AppData', 'Local'),
        programFiles: path.join(root, 'PF'),
        programFilesX86: path.join(root, 'PF86')
    }, over || {}));
}

function makeCtx(root, over) {
    const { ReceiptStore } = require('../src/core/receipts');
    const dataDir = path.join(root, 'AppData', 'Roaming', 'Vantyx Hub');
    return Object.assign({ env: makeEnv(root), dataDir, receipts: new ReceiptStore(dataDir) }, over || {});
}

module.exports = { tmp, rmrf, makeZip, makeToolDir, makeToolZip, toolFiles, manifestOf, makeEnv, makeCtx, CSXS };
