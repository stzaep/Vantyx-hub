'use strict';
// Removes ONLY the files recorded in the receipt. Foreign files inside the
// install folder are never touched. User data is kept unless the caller
// explicitly asks for removal, and even then only inside allowed roots.
const fs = require('fs');
const path = require('path');
const { HubError } = require('./errors');
const { resolveInside, assertNoLinks, isInside, samePath, expandEnv } = require('./path-guard');
const kinds = require('../kinds');

function userDataRoots(env) { return [env.appData, env.localAppData]; }

// A user-data path may be deleted only if it is inside AppData/LocalAppData
// AND one of its segments contains "vantyx" (all Vantyx tools store there).
function checkUserDataPath(env, raw) {
    const full = path.resolve(expandEnv(raw, env.vars));
    const root = userDataRoots(env).find(r => r && isInside(r, full));
    if (!root) throw new HubError('USERDATA_PATH_REFUSED', 'User data path is outside allowed locations: ' + full);
    const rel = path.relative(root, full).split(path.sep);
    if (!rel.some(s => /vantyx/i.test(s))) throw new HubError('USERDATA_PATH_REFUSED', 'Refusing to delete a folder that is not Vantyx-named: ' + full);
    return full;
}

function listUserData(env, receipt) {
    const out = [];
    for (const raw of receipt.userData || []) {
        try { const p = checkUserDataPath(env, raw); if (fs.existsSync(p)) out.push(p); } catch (e) { /* ignore invalid */ }
    }
    return out;
}

// ctx: { env, dataDir, receipts }   opts: { targetKey='user', removeUserData=false }
function uninstall(ctx, id, opts) {
    const o = opts || {};
    const targetKey = o.targetKey || 'user';
    const receipt = ctx.receipts.get(id, targetKey);
    if (!receipt) throw new HubError('NOT_MANAGED', 'This tool was not installed by the Hub');

    const kind = kinds.get(receipt.kind);
    const target = kind.getTargets(ctx.env).find(t => t.key === targetKey);
    if (!target) throw new HubError('TARGET_UNAVAILABLE', 'Install target not available: ' + targetKey);
    if (!samePath(target.root, receipt.targetRoot)) throw new HubError('RECEIPT_ROOT_MISMATCH', 'Receipt does not match the install location');

    const installRoot = resolveInside(target.root, receipt.installDir);
    assertNoLinks(target.root, installRoot);

    // Resolve & validate EVERY path first; one bad entry aborts before any deletion.
    const planned = receipt.files.map(f => {
        const full = resolveInside(installRoot, f.path);
        assertNoLinks(installRoot, full);
        return { rel: f.path, full };
    });
    const dirsToTry = (receipt.dirs || []).map(d => resolveInside(installRoot, d))
        .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
    dirsToTry.push(installRoot);

    const remaining = [], errors = [];
    let removed = 0;
    for (const p of planned) {
        try {
            if (fs.existsSync(p.full)) {
                if (!fs.lstatSync(p.full).isFile()) { remaining.push(p.rel); errors.push(p.rel + ': not a file'); continue; }
                fs.unlinkSync(p.full);
                removed++;
            }
        } catch (e) { remaining.push(p.rel); errors.push(p.rel + ': ' + e.code); }
    }
    for (const d of dirsToTry) { try { fs.rmdirSync(d); } catch (e) { /* not empty (foreign files) or already gone */ } }

    let leftover = [];
    if (fs.existsSync(installRoot)) { try { leftover = fs.readdirSync(installRoot).slice(0, 20); } catch (e) { /* ignore */ } }

    const result = { id, removed, leftover, errors, userDataRemoved: [], userDataKept: [], warnings: [] };

    if (errors.length) {
        // Keep a receipt for what could not be removed so the user can retry.
        receipt.files = receipt.files.filter(f => remaining.includes(f.path));
        ctx.receipts.put(receipt);
        result.partial = true;
        return result;
    }
    ctx.receipts.remove(id, targetKey);

    if (o.removeUserData) {
        for (const raw of receipt.userData || []) {
            try {
                const p = checkUserDataPath(ctx.env, raw);
                if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); result.userDataRemoved.push(p); }
            } catch (e) { result.warnings.push(e.message); }
        }
    } else {
        result.userDataKept = listUserData(ctx.env, receipt);
    }
    return result;
}

module.exports = { uninstall, listUserData, checkUserDataPath };
