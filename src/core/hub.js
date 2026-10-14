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

function createHub(options) {
    const env = options.env || getEnv();
    const dataDir = options.dataDir;
    const libraryDirs = options.libraryDirs || [];
    const receipts = new ReceiptStore(dataDir);
    const ctx = { env, dataDir, receipts, runner: options.runner, hooks: options.hooks };

    function targetsFor(kind, manifest, receiptsForTool, id) {
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
        return install(ctx, pkg, opts);
    }

    async function uninstallTool(id, opts) { return uninstall(ctx, id, opts); }

    // Paths the UI may ask the main process to open (never arbitrary paths).
    function getPaths(id, targetKey) {
        const receipt = receipts.get(id, targetKey || 'user');
        if (!receipt) return { install: null, userData: [] };
        const kind = kinds.get(receipt.kind);
        const t = kind.getTargets(env).find(x => x.key === (targetKey || 'user'));
        return { install: t ? resolveInside(t.root, receipt.installDir) : null, userData: listUserData(env, receipt) };
    }

    // Preview of what uninstall would keep/remove (for the confirmation dialog).
    function previewUninstall(id, targetKey) {
        const receipt = receipts.get(id, targetKey || 'user');
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
