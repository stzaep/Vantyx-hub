'use strict';
// IPC for Hub updates and settings. `ipcMain` is injected so this can be
// tested without Electron. The renderer never supplies URLs or paths: the
// update feed is baked into the app by electron-builder (app-update.yml).
const { HubError } = require('../core/errors');
const { SCHEMA } = require('../core/settings');

function wrap(fn) {
    return async (event, ...args) => {
        try { return { ok: true, data: await fn(event, ...args) }; }
        catch (e) {
            return { ok: false, error: { code: e.code || 'ERROR', message: e.message || String(e), details: e.details || null } };
        }
    };
}

function registerUpdatesIpc({ ipcMain, updates, settings, getWindow, discordPresence }) {
    // Only the Hub's own window may call these channels.
    function trusted(event) {
        const win = getWindow && getWindow();
        if (!win || win.isDestroyed() || !event || event.sender !== win.webContents) throw new HubError('BAD_REQUEST', 'Untrusted sender');
    }
    const handle = (channel, fn) => ipcMain.handle(channel, wrap((event, ...args) => { trusted(event); return fn(...args); }));

    handle('updates:get-state', () => updates.getState());
    handle('updates:check', () => updates.check());
    handle('updates:download', () => updates.download());
    handle('updates:install', arg => {
        if (!arg || typeof arg !== 'object' || arg.confirmed !== true) throw new HubError('UPDATE_NOT_CONFIRMED', 'Restart must be confirmed by the user');
        return updates.installAndRestart({ confirmed: true });
    });
    handle('settings:get', () => settings.get());
    handle('discord:set-enabled', async enabled => {
        if (typeof enabled !== 'boolean') {
            throw new HubError('BAD_REQUEST', 'Invalid Discord setting');
        }
        if (!discordPresence) {
            throw new HubError('DISCORD_UNAVAILABLE', 'Discord Rich Presence is unavailable');
        }
        return discordPresence.setEnabled(enabled);
    });
    handle('settings:set', patch => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HubError('BAD_REQUEST', 'Invalid settings');
        const clean = {};
        for (const k of Object.keys(patch)) {
            if (!Object.prototype.hasOwnProperty.call(SCHEMA, k)) throw new HubError('BAD_REQUEST', 'Unknown setting');
            clean[k] = patch[k];
        }
        return settings.set(clean);
    });

    // push state changes to the window (progress, availability...)
    updates.on('state', st => {
        const win = getWindow && getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('updates:state', st);
    });
}

module.exports = { registerUpdatesIpc, wrap };
