'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { HubError } = require('./errors');
const version = require('./version');
const { detectAfterEffects } = require('./ae-detect');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const execFileAsync = promisify(execFile);

async function elevate(planPath, helperPath) {
    const ps = p => "'" + String(p).replace(/'/g, "''") + "'";
    const command = `$argsLine='-NoProfile -ExecutionPolicy Bypass -File "' + ${ps(helperPath)} + '" "' + ${ps(planPath)} + '"'; $p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argsLine; exit $p.ExitCode`;
    try {
        await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: 120000 });
    } catch (e) {
        if (e.code === 'ENOENT') throw new HubError('ELEVATION_UNAVAILABLE', 'PowerShell is not available');
        if (e.killed) throw new HubError('ELEVATION_TIMEOUT', 'Administrator operation timed out');
        throw new HubError('ELEVATION_FAILED', 'Administrator operation failed or was cancelled. ' + (e.stderr || e.message).trim());
    }
}

async function runOperations(ctx, operations) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vantyx-aex-'));
    const planPath = path.join(work, 'plan.json');
    try {
        fs.writeFileSync(planPath, JSON.stringify({ operations }, null, 2), 'utf8');
        const helperPath = ctx.elevatedHelperPath || path.join(__dirname, '..', '..', 'scripts', 'elevated-file-ops.ps1');
        if (ctx.elevate) await ctx.elevate({ planPath, helperPath, operations });
        else if (process.platform === 'win32') await elevate(planPath, helperPath);
        else throw new HubError('PLATFORM_UNSUPPORTED', 'Native AEX plugins can only be installed on Windows');
    } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} }
}

function getAexFile(pkg) { return pkg.files.find(f => /^VTX-Console\.aex$/i.test(f.path)); }

async function installAll(ctx, pkg, opts) {
    const targets = detectAfterEffects(ctx.env);
    if (!targets.length) throw new HubError('NO_AFTER_EFFECTS', 'No compatible After Effects installations were found');
    const file = getAexFile(pkg);
    if (!file) throw new HubError('PAYLOAD_INVALID', 'VTX-Console.aex is missing');
    const data = file.read();
    const hash = sha256(data);
    const stageDir = path.join(ctx.dataDir, 'staging');
    const source = path.join(stageDir, 'VTX-Console-' + pkg.manifest.version + '.aex');
    const operations = [];
    const nextReceipts = [];
    let hadReceipts = 0;
    let hadOlder = false;
    let allCurrent = true;
    for (const ae of targets) {
        const key = 'ae-' + ae.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const destination = path.join(ae.vantyxPlugInsDir, 'VTX-Console.aex');
        const prev = ctx.receipts.get(pkg.manifest.id, key);
        if (prev) { hadReceipts++; if (version.compare(pkg.manifest.version, prev.version) > 0) hadOlder = true; }
        if (!prev || prev.version !== pkg.manifest.version || !fs.existsSync(destination)) allCurrent = false;
        else { try { if (sha256(fs.readFileSync(destination)) !== hash) allCurrent = false; } catch (_) { allCurrent = false; } }
        if (fs.existsSync(destination) && !prev && !opts.replaceUnmanaged) {
            throw new HubError('UNMANAGED_EXISTS', 'VTX Console already exists and is not managed by Vantyx Hub', { path: destination });
        }
        operations.push({ action: 'install', source, destination, sha256: hash, overwrite: !!prev || !!opts.replaceUnmanaged });
        nextReceipts.push({ id: pkg.manifest.id, name: pkg.manifest.name, kind: pkg.manifest.kind, version: pkg.manifest.version, targetKey: key, targetRoot: ae.plugInsDir, installDir: 'Vantyx', installedAt: prev ? prev.installedAt : new Date().toISOString(), updatedAt: new Date().toISOString(), files: [{ path: 'VTX-Console.aex', sha256: hash, size: data.length }], dirs: [], userData: [] });
    }
    if (allCurrent && !opts.repair) return { action: 'already-installed', id: pkg.manifest.id, version: pkg.manifest.version, written: 0, removed: 0, installedVersions: targets.map(a => a.label), warnings: [] };
    fs.mkdirSync(stageDir, { recursive: true });
    fs.writeFileSync(source, data);
    try { await runOperations(ctx, operations); }
    finally { try { fs.unlinkSync(source); } catch (_) {} }
    for (const receipt of nextReceipts) ctx.receipts.put(receipt);
    return { action: hadReceipts === targets.length ? (hadOlder ? 'updated' : 'repaired') : 'installed', id: pkg.manifest.id, version: pkg.manifest.version, written: operations.length, removed: 0, installPath: targets.map(a => path.join(a.vantyxPlugInsDir, 'VTX-Console.aex')).join('; '), installedVersions: targets.map(a => a.label), warnings: [] };
}

async function uninstallAll(ctx, id) {
    const receipts = ctx.receipts.list().filter(r => r.id === id && r.kind === 'aex');
    if (!receipts.length) throw new HubError('NOT_MANAGED', 'VTX Console is not installed by Vantyx Hub');
    const operations = [];
    for (const r of receipts) {
        const target = detectAfterEffects(ctx.env).find(a => ('ae-' + a.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) === r.targetKey);
        const root = target ? target.vantyxPlugInsDir : path.join(r.targetRoot, r.installDir);
        const dest = path.join(root, 'VTX-Console.aex');
        operations.push({ action: 'uninstall', destination: dest, sha256: r.files[0].sha256 });
    }
    await runOperations(ctx, operations);
    for (const r of receipts) ctx.receipts.remove(id, r.targetKey);
    return { id, removed: operations.length, leftover: [], errors: [], userDataRemoved: [], userDataKept: [], warnings: [] };
}

module.exports = { installAll, uninstallAll };
