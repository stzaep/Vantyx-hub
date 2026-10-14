'use strict';
// The renderer can only call these handlers. Arguments are validated here;
// the renderer never supplies file paths.
const { ipcMain } = require('electron');
const { HubError } = require('../core/errors');

const ID_RX = /^[a-z0-9][a-z0-9-]{1,62}$/;

function checkId(id) {
    if (typeof id !== 'string' || !ID_RX.test(id)) throw new HubError('BAD_REQUEST', 'Invalid tool id');
    return id;
}
function flags(opts, allowed) {
    const out = {};
    const o = opts && typeof opts === 'object' ? opts : {};
    for (const k of allowed) if (o[k] === true) out[k] = true;
    return out;
}
function wrap(fn) {
    return async (event, ...args) => {
        try { return { ok: true, data: await fn(...args) }; }
        catch (e) {
            return { ok: false, error: { code: e.code || 'ERROR', message: e.message || String(e), details: e.details || null } };
        }
    };
}

function registerIpc({ hub, shell }) {
    // Number of install/uninstall operations running; the updater refuses to
    // restart the app while this is above zero.
    let inflight = 0;
    const tracked = fn => async (...a) => { inflight++; try { return await fn(...a); } finally { inflight--; } };
    ipcMain.handle('hub:list', wrap(() => hub.listTools()));
    ipcMain.handle('hub:env', wrap(() => hub.envInfo()));
    ipcMain.handle('hub:install', wrap(tracked((id, opts) => hub.installTool(checkId(id), flags(opts, ['repair', 'replaceUnmanaged'])))));
    ipcMain.handle('hub:uninstall', wrap(tracked((id, opts) => hub.uninstallTool(checkId(id), flags(opts, ['removeUserData'])))));
    ipcMain.handle('hub:preview-uninstall', wrap(id => hub.previewUninstall(checkId(id))));
    ipcMain.handle('hub:open', wrap(async (id, what) => {
        checkId(id);
        const p = hub.getPaths(id);
        const target = what === 'userdata' ? p.userData[0] : p.install;
        if (!target) throw new HubError('NOTHING_TO_OPEN', 'Nothing to open');
        const err = await shell.openPath(target);
        if (err) throw new HubError('OPEN_FAILED', err);
        return true;
    }));
    return { isBusy: () => inflight > 0 };
}

module.exports = { registerIpc };
