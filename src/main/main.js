
'use strict';

const {
    app,
    BrowserWindow,
    Menu,
    Tray,
    ipcMain,
    session,
    shell
} = require('electron');

const path = require('path');
const fs = require('fs');

const { createHub } = require('../core/hub');
const { createSettings } = require('../core/settings');

const {
    createUpdateService,
    parseFeedConfig,
    isFeedConfigured
} = require('../core/updater');

const { registerIpc } = require('./ipc');
const { registerUpdatesIpc } = require('./updates-ipc');

const AUTO_CHECK_DELAY_MS = 5000;

// Servicio de actualizaciones.
function setupUpdates({ dataDir, isBusy }) {
    let disabledReason = null;
    let autoUpdater = null;

    if (!app.isPackaged) {
        disabledReason = 'dev';
    } else if (process.env.PORTABLE_EXECUTABLE_FILE) {
        disabledReason = 'portable';
    } else {
        try {
            const cfg = parseFeedConfig(
                fs.readFileSync(
                    path.join(
                        process.resourcesPath,
                        'app-update.yml'
                    ),
                    'utf8'
                )
            );

            if (!isFeedConfigured(cfg)) {
                disabledReason = 'not-configured';
            }
        } catch (e) {
            disabledReason = 'not-configured';
        }
    }

    if (!disabledReason) {
        try {
            autoUpdater = require('electron-updater').autoUpdater;
        } catch (e) {
            disabledReason = 'not-configured';
        }
    }

    const updates = createUpdateService({
        autoUpdater,
        currentVersion: app.getVersion(),
        disabledReason,
        canInstall: () => !isBusy()
    });

    return {
        updates,
        settings: createSettings({ dir: dataDir })
    };
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    let win = null;
    let tray = null;
    let isQuitting = false;

    const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', '..', 'build', 'icon.ico');

    // Mostrar la ventana principal.
    function showWindow() {
        if (!win) {
            createWindow();
        }

        if (win.isMinimized()) {
            win.restore();
        }

        win.show();
        win.focus();
    }

    // Crear el icono y el menú de la bandeja del sistema.
    function createTray() {
        tray = new Tray(iconPath);
        tray.setToolTip('Vantyx Hub');

        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'Abrir Vantyx Hub',
                click: () => showWindow()
            },
            {
                type: 'separator'
            },
            {
                label: 'Salir',
                click: () => {
                    isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);

        // Un clic izquierdo abre la ventana.
        tray.on('click', () => {
            showWindow();
        });

        // Un doble clic también abre la ventana.
        tray.on('double-click', () => {
            showWindow();
        });
    }

    // Si se intenta abrir otra instancia, mostrar la existente.
    app.on('second-instance', () => {
        showWindow();
    });

    function createWindow() {
        win = new BrowserWindow({
            width: 1020,
            height: 700,
            minWidth: 820,
            minHeight: 560,
            backgroundColor: '#0c0d10',
            title: 'Vantyx Hub',
            icon: iconPath,
            titleBarStyle: 'hidden',
            titleBarOverlay: {
                color: '#0c0d10',
                symbolColor: '#ffffff',
                height: 36
            },
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
                webSecurity: true
            }
        });

        win.webContents.setWindowOpenHandler(
            () => ({ action: 'deny' })
        );

        win.webContents.on('will-navigate', event => {
            event.preventDefault();
        });

        win.loadFile(
            path.join(__dirname, '..', 'renderer', 'index.html')
        );

        // La X oculta la ventana, pero mantiene la aplicación activa.
        win.on('close', event => {
            if (!isQuitting) {
                event.preventDefault();
                win.hide();
            }
        });

        win.on('closed', () => {
            win = null;
        });
    }

    app.whenReady().then(() => {
        Menu.setApplicationMenu(null);

        session.defaultSession.setPermissionRequestHandler(
            (webContents, permission, callback) => {
                callback(false);
            }
        );

        const dataDir = path.join(
            app.getPath('appData'),
            'Vantyx Hub'
        );

        const bundled = app.isPackaged
            ? path.join(process.resourcesPath, 'library')
            : path.join(__dirname, '..', '..', 'library');

        const hub = createHub({
            dataDir,
            libraryDirs: [
                bundled,
                path.join(dataDir, 'library')
            ]
        });

        const ipc = registerIpc({
            hub,
            shell
        });

        const { updates, settings } = setupUpdates({
            dataDir,
            isBusy: ipc.isBusy
        });

        registerUpdatesIpc({
            ipcMain,
            updates,
            settings,
            getWindow: () => win
        });

        // Crear el icono antes de abrir la ventana.
        createTray();
        createWindow();

        // Comprobación automática de actualizaciones.
        if (
            updates.getState().status !== 'disabled' &&
            settings.get().autoCheckUpdates
        ) {
            setTimeout(() => {
                updates.check().catch(() => {});
            }, AUTO_CHECK_DELAY_MS);
        }
    });

    // Permitir que la aplicación se cierre cuando el usuario lo solicite.
    app.on('before-quit', () => {
        isQuitting = true;
    });

    // No cerrar la aplicación cuando se oculta o cierra la ventana.
    app.on('window-all-closed', () => {
        // Vantyx Hub permanece activo en la bandeja.
    });

    // Liberar el icono al cerrar completamente la aplicación.
    app.on('will-quit', () => {
        if (tray) {
            tray.destroy();
            tray = null;
        }
    });
}
