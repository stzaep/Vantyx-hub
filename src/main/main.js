'use strict';
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createHub } = require('../core/hub');
const { createSettings } = require('../core/settings');
const { createUpdateService, parseFeedConfig, isFeedConfigured } = require('../core/updater');
const { registerIpc } = require('./ipc');
const { registerUpdatesIpc } = require('./updates-ipc');

const AUTO_CHECK_DELAY_MS = 5000;

// Builds the update service. Updates are only active in an installed
// (packaged, non-portable) build whose feed has been configured; otherwise the
// UI explains why instead of failing.
function setupUpdates({ dataDir, isBusy }) {
    let disabledReason = null;
    let autoUpdater = null;
    if (!app.isPackaged) disabledReason = 'dev';
    else if (process.env.PORTABLE_EXECUTABLE_FILE) disabledReason = 'portable';
    else {
        try {
            const cfg = parseFeedConfig(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
            if (!isFeedConfigured(cfg)) disabledReason = 'not-configured';
        } catch (e) { disabledReason = 'not-configured'; }
    }
    if (!disabledReason) {
        try { autoUpdater = require('electron-updater').autoUpdater; }
        catch (e) { disabledReason = 'not-configured'; }
    }
    const updates = createUpdateService({ autoUpdater, currentVersion: app.getVersion(), disabledReason, canInstall: () => !isBusy() });
    return { updates, settings: createSettings({ dir: dataDir }) };
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    let win = null;

    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });

    function createWindow() {
        win = new BrowserWindow({
            width: 1020, height: 700, minWidth: 820, minHeight: 560,
            backgroundColor: '#0c0d10',
            title: 'Vantyx Hub',
            icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: '#0c0d10', symbolColor: '#ffffff', height: 36 },
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                webSecurity: true
            }
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', e => e.preventDefault());
        win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
        win.on('closed', () => { win = null; });
    }

    app.whenReady().then(() => {
        Menu.setApplicationMenu(null);
        session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false));

        const dataDir = path.join(app.getPath('appData'), 'Vantyx Hub');
        const bundled = app.isPackaged
            ? path.join(process.resourcesPath, 'library')
            : path.join(__dirname, '..', '..', 'library');
        const hub = createHub({ dataDir, libraryDirs: [bundled, path.join(dataDir, 'library')] });

        const ipc = registerIpc({ hub, shell });
        const { updates, settings } = setupUpdates({ dataDir, isBusy: ipc.isBusy });
        registerUpdatesIpc({ ipcMain, updates, settings, getWindow: () => win });
        createWindow();

        // Optional check on startup (setting). Never downloads or restarts by itself.
        if (updates.getState().status !== 'disabled' && settings.get().autoCheckUpdates) {
            setTimeout(() => { updates.check().catch(() => {}); }, AUTO_CHECK_DELAY_MS);
        }
    });

    app.on('window-all-closed', () => app.quit());
}
