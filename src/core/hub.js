'use strict';
// Service layer: everything the UI can ask for. No Electron imports here, so
// it can be tested with plain Node.
const fs = require('fs');
const path = require('path');
const { HubError } = require('./errors');
const { getEnv } = require('./env');
const { ReceiptStore } = require('./receipts');
const { scanLibrary } = require('./library');
const { openPackage } = require('./package-reader');
const { inspectInstall } = require('./status');
const { install } = require('./installer');
const { uninstall, listUserData } = require('./uninstaller');
const { resolveInside, expandEnv } = require('./path-guard');
const { detectAfterEffects } = require('./ae-detect');
const cepDebug = require('./cep-debug');
const kinds = require('../kinds');
const aexInstaller = require('./aex-installer');

function createHub(options) {
    const env = options.env || getEnv();
    const dataDir = options.dataDir;
    const libraryDirs = options.libraryDirs || [];
    const receipts = new ReceiptStore(dataDir);
    const ctx = { env, dataDir, receipts, runner: options.runner, hooks: options.hooks, elevate: options.elevate, elevatedHelperPath: options.elevatedHelperPath };

    function targetsFor(kind, manifest, receiptsForTool, id) {
        if (kind.id === 'aex') {
            const detected = detectAfterEffects(env);
            const states = detected.map(ae => {
                const key = 'ae-' + ae.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const receipt = receipts.get(id, key);
                const installPath = path.join(ae.vantyxPlugInsDir, 'VTX-Console.aex');
                let state = 'not-installed', missing = [], modified = [], installedVersion = null;
                if (receipt) {
                    installedVersion = receipt.version;
                    if (!fs.existsSync(installPath)) { state = 'incomplete'; missing = ['VTX-Console.aex']; }
                    else {
                        const actual = require('crypto').createHash('sha256').update(fs.readFileSync(installPath)).digest('hex');
                        if (actual !== receipt.files[0].sha256) state = 'modified';
                        else if (manifest && require('./version').compare(manifest.version, receipt.version) > 0) state = 'outdated';
                        else state = 'installed';
                    }
                } else if (fs.existsSync(installPath)) state = 'unmanaged';
                return { label: ae.name, state, missing, modified, installedVersion, installPath };
            });
            // Keep old receipts visible so the user can still uninstall the plugin
            // if an After Effects version was removed or renamed.
            if (!detected.length) {
                for (const receipt of receipts.list().filter(r => r.id === id && r.kind === 'aex')) {
                    const installPath = path.join(receipt.targetRoot, receipt.installDir, 'VTX-Console.aex');
                    const exists = fs.existsSync(installPath);
                    let state = exists ? 'installed' : 'incomplete';
                    if (exists) {
                        const actual = require('crypto').createHash('sha256').update(fs.readFileSync(installPath)).digest('hex');
                        if (actual !== receipt.files[0].sha256) state = 'modified';
                    }
                    states.push({ label: receipt.targetKey.replace(/^ae-/, 'After Effects '), state, missing: exists ? [] : ['VTX-Console.aex'], modified: [], installedVersion: receipt.version, installPath });
                }
            }
            const installed = states.filter(x => x.state === 'installed').length;
            const problem = states.find(x => ['modified','incomplete','unmanaged','outdated'].includes(x.state));
            const state = !states.length ? 'unavailable' : (problem ? problem.state : (installed === states.length ? 'installed' : (installed > 0 ? 'incomplete' : 'not-installed')));
            return [{ key: 'all', label: 'All detected After Effects versions', available: states.length > 0, needsAdmin: true, root: null, installPath: states.map(x => x.installPath).join('\n'), state, missing: states.flatMap(x => x.missing), modified: states.flatMap(x => x.modified), installedVersion: states.find(x => x.installedVersion)?.installedVersion || null, detectedVersions: states.map(x => ({ label: x.label, state: x.state, installPath: x.installPath })) }];
        }
        return kind.getTargets(env).map(t => {
            const receipt = receipts.get(id, t.key);
            const installDir = receipt ? receipt.installDir : (manifest && manifest.installDir);
            const base = { key: t.key, label: t.label, available: t.available, needsAdmin: t.needsAdmin, root: t.root, installPath: null };
            if (!installDir) return Object.assign(base, { state: 'not-installed', missing: [], modified: [], installedVersion: null });
            try {
                const installRoot = resolveInside(t.root, installDir);
                const info = inspectInstall({ receipt, installRoot, pkgVersion: manifest && manifest.version });
                return Object.assign(base, info, { installPath: installRoot });
            } catch (e) {
                return Object.assign(base, { state: 'error', error: { code: e.code || 'ERROR', message: e.message }, missing: [], modified: [], installedVersion: receipt ? receipt.version : null });
            }
        });
    }

    async function listTools() {
        const lib = scanLibrary(libraryDirs);
        const orphans = receipts.list().filter(r => !lib.byId.has(r.id));
        const items = [];
        for (const entry of lib.byId.values()) {
            const m = entry.latest.manifest;
            items.push({
                id: m.id, name: m.name, version: m.version, kind: m.kind, kindLabel: kinds.get(m.kind).label,
                description: m.description, author: m.author, inLibrary: true,
                versions: entry.versions.map(v => v.version),
                targets: targetsFor(kinds.get(m.kind), m, null, m.id)
            });
        }
        const seen = new Set();
        for (const r of orphans) {
            if (seen.has(r.id) || !kinds.has(r.kind)) continue;
            seen.add(r.id);
            items.push({
                id: r.id, name: r.name, version: null, kind: r.kind, kindLabel: kinds.get(r.kind).label,
                description: '', author: '', inLibrary: false, versions: [],
                targets: targetsFor(kinds.get(r.kind), null, null, r.id)
            });
        }
        items.sort((a, b) => a.name.localeCompare(b.name));
        return { tools: items, problems: lib.problems, warning: receipts.warning };
    }

    function pickEntry(id) {
        const lib = scanLibrary(libraryDirs);
        const entry = lib.byId.get(id);
        if (!entry) throw new HubError('TOOL_NOT_IN_LIBRARY', 'Tool not found in the library: ' + id);
        return entry;
    }

    async function installTool(id, opts) {
        const entry = pickEntry(id);
        const pkg = openPackage(entry.latest.source);
        if (pkg.manifest.kind === 'aex') return aexInstaller.installAll(ctx, pkg, opts || {});
        return install(ctx, pkg, opts);
    }

    async function uninstallTool(id, opts) {
        const receipt = receipts.list().find(r => r.id === id);
        if (receipt && receipt.kind === 'aex') return aexInstaller.uninstallAll(ctx, id);
        return uninstall(ctx, id, opts);
    }

    // Paths the UI may ask the main process to open (never arbitrary paths).
    function getPaths(id, targetKey) {
        const receipt = (targetKey === 'all' || !targetKey) ? receipts.list().find(r => r.id === id) : receipts.get(id, targetKey || 'user');
        if (!receipt) return { install: null, userData: [] };
        const kind = kinds.get(receipt.kind);
        const t = kind.getTargets(env).find(x => x.key === receipt.targetKey);
        return { install: t ? path.join(t.root, receipt.installDir) : path.join(receipt.targetRoot, receipt.installDir), userData: listUserData(env, receipt) };
    }

    // Preview of what uninstall would keep/remove (for the confirmation dialog).
    function previewUninstall(id, targetKey) {
        const receipt = (targetKey === 'all' || !targetKey) ? receipts.list().find(r => r.id === id) : receipts.get(id, targetKey || 'user');
        if (!receipt) throw new HubError('NOT_MANAGED', 'This tool was not installed by the Hub');
        return { name: receipt.name, userData: listUserData(env, receipt) };
    }

    async function envInfo() {
        return {
            platform: env.platform,
            afterEffects: detectAfterEffects(env).map(a => ({ name: a.name, label: a.label, dir: a.dir, beta: a.beta })),
            cepDebug: await cepDebug.status({ runner: options.runner, platform: env.platform }),
            dataDir
        };
    }

    return { listTools, installTool, uninstallTool, getPaths, previewUninstall, envInfo, _ctx: ctx };
}

module.exports = { createHub };
