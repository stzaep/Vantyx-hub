'use strict';
// Transactional install / update / repair.
//   1. Preflight: every file is validated, decompressed and hash-checked in
//      memory BEFORE anything is written.
//   2. Writes go through a journal; on any error everything is rolled back.
//   3. The receipt is written last.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HubError } = require('./errors');
const { safeRelative, resolveInside, assertNoLinks } = require('./path-guard');
const { inspectInstall } = require('./status');
const version = require('./version');
const kinds = require('../kinds');

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function resolveTarget(env, kind, targetKey) {
    const t = kind.getTargets(env).find(x => x.key === targetKey);
    if (!t || !t.available) throw new HubError('TARGET_UNAVAILABLE', 'Install target not available: ' + targetKey);
    if (t.needsAdmin) throw new HubError('NEEDS_ELEVATION', 'This target needs administrator rights');
    return t;
}

function moveDir(src, dst) {
    try { fs.renameSync(src, dst); }
    catch (e) {
        fs.cpSync(src, dst, { recursive: true });
        fs.rmSync(src, { recursive: true, force: true });
    }
}

function ensureDir(dir, journal) {
    const missing = [];
    let cur = dir;
    while (!fs.existsSync(cur)) {
        missing.push(cur);
        const up = path.dirname(cur);
        if (up === cur) break;
        cur = up;
    }
    for (let i = missing.length - 1; i >= 0; i--) {
        fs.mkdirSync(missing[i]);
        journal.createdDirs.push(missing[i]);
    }
}

function rollback(journal) {
    for (const f of journal.created.slice().reverse()) { try { fs.unlinkSync(f); } catch (e) { /* best effort */ } }
    for (const b of journal.backups.slice().reverse()) {
        try { fs.mkdirSync(path.dirname(b.full), { recursive: true }); fs.copyFileSync(b.backup, b.full); } catch (e) { /* best effort */ }
    }
    for (const d of journal.createdDirs.slice().reverse()) { try { fs.rmdirSync(d); } catch (e) { /* not empty or gone */ } }
    if (journal.moved) { try { moveDir(journal.moved.to, journal.moved.from); } catch (e) { /* best effort */ } }
}

// ctx: { env, dataDir, receipts, runner?, hooks? }
// opts: { targetKey='user', repair=false, replaceUnmanaged=false, allowDowngrade=false }
async function install(ctx, pkg, opts) {
    const o = opts || {};
    const { manifest, files } = pkg;
    const kind = kinds.get(manifest.kind);
    const targetKey = o.targetKey || 'user';
    const target = resolveTarget(ctx.env, kind, targetKey);

    fs.mkdirSync(target.root, { recursive: true });
    const installRoot = resolveInside(target.root, manifest.installDir);
    assertNoLinks(target.root, installRoot);

    const prev = ctx.receipts.get(manifest.id, targetKey);
    let action = 'installed', previousVersion = null;
    if (prev) {
        previousVersion = prev.version;
        const cmp = version.compare(manifest.version, prev.version);
        if (cmp < 0 && !o.allowDowngrade) {
            throw new HubError('DOWNGRADE_BLOCKED', 'Installed version ' + prev.version + ' is newer than ' + manifest.version);
        }
        const st = inspectInstall({ receipt: prev, installRoot, pkgVersion: manifest.version });
        if (cmp === 0 && st.state === 'installed' && !o.repair) {
            return { action: 'already-installed', id: manifest.id, version: prev.version, installPath: installRoot, warnings: [] };
        }
        action = (cmp === 0 || o.repair) ? 'repaired' : 'updated';
    } else if (fs.existsSync(installRoot) && !o.replaceUnmanaged) {
        throw new HubError('UNMANAGED_EXISTS', 'A folder with this name already exists and was not installed by the Hub', { path: installRoot });
    }

    // ---- preflight (nothing is written yet)
    kind.validatePayload(files);
    const planned = files.map(f => {
        const rel = safeRelative(f.path);
        const full = resolveInside(installRoot, rel);
        assertNoLinks(installRoot, full);
        const data = f.read();
        if (sha256(data) !== f.sha256) throw new HubError('PACKAGE_CORRUPT', 'Hash mismatch for ' + rel);
        try { if (fs.statSync(full).isDirectory()) throw new HubError('PATH_CONFLICT', 'A folder exists where a file must be written: ' + rel); }
        catch (e) { if (e instanceof HubError) throw e; }
        return { rel, full, data, sha256: f.sha256, size: data.length };
    });

    // ---- transaction
    const txnDir = path.join(ctx.dataDir, 'tmp', 'txn-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    const journal = { created: [], createdDirs: [], backups: [], moved: null };
    let backupN = 0, removed = 0, receipt;
    const backupFile = full => {
        const b = path.join(txnDir, 'files', String(backupN++));
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(full, b);
        journal.backups.push({ full, backup: b });
    };

    try {
        fs.mkdirSync(txnDir, { recursive: true });

        if (!prev && fs.existsSync(installRoot)) {
            const dst = path.join(ctx.dataDir, 'backups', manifest.id + '-' + stamp());
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            moveDir(installRoot, dst);
            journal.moved = { from: installRoot, to: dst };
        }

        const keep = new Set(planned.map(p => p.rel));
        if (prev) {
            for (const old of prev.files) {
                if (keep.has(old.path)) continue;
                const full = resolveInside(installRoot, old.path);
                assertNoLinks(installRoot, full);
                if (fs.existsSync(full) && fs.lstatSync(full).isFile()) {
                    backupFile(full);
                    fs.unlinkSync(full);
                    removed++;
                }
            }
        }

        planned.forEach((p, i) => {
            ensureDir(path.dirname(p.full), journal);
            if (fs.existsSync(p.full)) backupFile(p.full); else journal.created.push(p.full);
            const tmp = p.full + '.vtx-tmp';
            fs.writeFileSync(tmp, p.data);
            fs.renameSync(tmp, p.full);
            if (ctx.hooks && ctx.hooks.afterWrite) ctx.hooks.afterWrite(i, p.rel);
        });

        for (const p of planned) {
            if (sha256(fs.readFileSync(p.full)) !== p.sha256) throw new HubError('WRITE_VERIFY_FAILED', 'Verification failed for ' + p.rel);
        }

        const dirs = new Set();
        for (const p of planned) {
            const parts = p.rel.split('/'); parts.pop();
            for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        }
        receipt = {
            id: manifest.id, name: manifest.name, kind: manifest.kind, version: manifest.version,
            targetKey, targetRoot: target.root, installDir: manifest.installDir,
            installedAt: prev ? prev.installedAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: planned.map(p => ({ path: p.rel, sha256: p.sha256, size: p.size })),
            dirs: Array.from(dirs),
            userData: manifest.userData
        };
        ctx.receipts.put(receipt);
    } catch (err) {
        rollback(journal);
        try { fs.rmSync(txnDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        if (err instanceof HubError) { err.details = Object.assign({ rolledBack: true }, err.details || {}); throw err; }
        throw new HubError('INSTALL_FAILED', 'Install failed and was rolled back: ' + err.message, { rolledBack: true });
    }
    try { fs.rmSync(txnDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }

    const warnings = [];
    let extra = {};
    try { extra = (await kind.afterInstall({ manifest, env: ctx.env, runner: ctx.runner })) || {}; }
    catch (e) { warnings.push('Post-install step failed: ' + e.message); }
    if (extra.debugMode === 'partial') warnings.push('Could not enable unsigned-extension mode for every CSXS version');

    return {
        action, id: manifest.id, version: manifest.version, previousVersion,
        written: planned.length, removed, installPath: installRoot,
        backupPath: journal.moved ? journal.moved.to : null,
        debugMode: extra.debugMode || null, warnings
    };
}

module.exports = { install, resolveTarget };
