'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('hub', {
    list: () => call('hub:list'),
    env: () => call('hub:env'),
    install: (id, opts) => call('hub:install', id, opts),
    uninstall: (id, opts) => call('hub:uninstall', id, opts),
    previewUninstall: id => call('hub:preview-uninstall', id),
    open: (id, what) => call('hub:open', id, what)
});

// Updates: only check / download / install (with explicit confirmation) and a
// state listener. No URLs, paths or generic IPC are exposed.
contextBridge.exposeInMainWorld('updates', {
    getState: () => call('updates:get-state'),
    check: () => call('updates:check'),
    download: () => call('updates:download'),
    installAndRestart: () => call('updates:install', { confirmed: true }),
    onState: cb => {
        if (typeof cb !== 'function') return () => {};
        const handler = (_e, st) => cb(st);
        ipcRenderer.on('updates:state', handler);
        return () => ipcRenderer.removeListener('updates:state', handler);
    }
});

contextBridge.exposeInMainWorld('discord', {
    setEnabled: enabled => call('discord:set-enabled', enabled)
});

contextBridge.exposeInMainWorld('settings', {
    get: () => call('settings:get'),
    set: patch => call('settings:set', patch)
});
