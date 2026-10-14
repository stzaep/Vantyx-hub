'use strict';
// Update service for Vantyx Hub itself (the app, not the After Effects tools).
//
// It wraps an `autoUpdater` (electron-updater) that is INJECTED, so the logic
// can be tested without Electron. It deliberately does not know about
// installer / uninstaller / receipts: updating the Hub never touches the
// tools installed in After Effects.
//
// Flow: idle -> checking -> available | not-available | error
//       available -> downloading -> downloaded -> (user confirms) -> restart
const { EventEmitter } = require('events');
const { HubError } = require('./errors');
const version = require('./version');

const NOTES_MAX = 4000;

// ---- release notes: GitHub returns HTML (or a list of {version, note}); the UI only shows plain text.
function notesToText(notes) {
    let s = '';
    if (typeof notes === 'string') s = notes;
    else if (Array.isArray(notes)) {
        s = notes.map(n => {
            if (!n) return '';
            const body = typeof n === 'string' ? n : (n.note || '');
            return n.version ? 'v' + n.version + '\n' + body : body;
        }).join('\n\n');
    }
    s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return s.length > NOTES_MAX ? s.slice(0, NOTES_MAX) + '…' : s;
}

// ---- feed config (app-update.yml written by electron-builder next to the app)
// Minimal "key: value" reader; avoids a YAML dependency.
function parseFeedConfig(text) {
    const out = {};
    String(text || '').split(/\r?\n/).forEach(line => {
        const m = /^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
    return out;
}

const PLACEHOLDER = /^(YOUR[_-]|REPLACE[_-]|CHANGE[_-]|<)/i;
function isFeedConfigured(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    const ok = v => typeof v === 'string' && v.trim() !== '' && !PLACEHOLDER.test(v.trim());
    if (cfg.provider === 'github') return ok(cfg.owner) && ok(cfg.repo);
    if (cfg.provider === 'generic') return ok(cfg.url) && /^https:\/\//i.test(cfg.url);
    return false;
}

// ---- error classification
const NETWORK = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_TIMED_OUT|ERR_PROXY|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|net::/i;
function classifyError(err) {
    if (err && err.code && String(err.code).indexOf('UPDATE_') === 0) return { code: err.code, message: err.message };
    const text = ((err && (err.code || '')) + ' ' + (err && err.message || err || '')).toString();
    let code = 'UPDATE_ERROR';
    if (NETWORK.test(text)) code = 'UPDATE_OFFLINE';
    else if (/sha512|sha256|checksum|integrity/i.test(text)) code = 'UPDATE_CHECKSUM';
    else if (/\b404\b|Cannot find latest|latest\.yml|HttpError: 404/i.test(text)) code = 'UPDATE_FEED_NOT_FOUND';
    else if (/signature|publisher|not signed/i.test(text)) code = 'UPDATE_SIGNATURE';
    const first = String(err && err.message ? err.message : err || 'Update error').split('\n')[0].slice(0, 300);
    return { code, message: first };
}

function createUpdateService(opts) {
    const {
        autoUpdater,
        currentVersion,
        disabledReason = null,      // 'dev' | 'portable' | 'not-configured' | null
        canInstall = () => true,    // false while a tool install/uninstall is running
        now = () => Date.now()
    } = opts;

    if (!version.isValid(currentVersion)) throw new Error('Invalid current version: ' + currentVersion);

    const emitter = new EventEmitter();
    let state = {
        status: disabledReason ? 'disabled' : 'idle',
        currentVersion,
        disabledReason: disabledReason || null,
        info: null,          // { version, notes, releaseDate }
        progress: null,      // { percent, transferred, total, bytesPerSecond }
        error: null,         // { code, message }
        lastChecked: null,
        seq: 0               // grows with every change, so the UI can ignore stale replies
    };
    let lastPercent = -1;
    let restarting = false;

    function emit() { emitter.emit('state', getState()); }
    function getState() { return JSON.parse(JSON.stringify(state)); }
    function set(patch) { state = Object.assign({}, state, patch, { seq: state.seq + 1 }); emit(); }
    function setError(err) {
        const e = classifyError(err);
        set({ status: 'error', error: e, progress: null });
        return e;
    }

    if (!disabledReason && autoUpdater) {
        autoUpdater.autoDownload = false;          // the user decides
        autoUpdater.autoInstallOnAppQuit = false;  // never install behind the user's back
        autoUpdater.allowDowngrade = false;
        autoUpdater.allowPrerelease = false;

        autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
        autoUpdater.on('update-available', info => onAvailable(info));
        autoUpdater.on('update-not-available', () => set({ status: 'not-available', info: null, progress: null, error: null, lastChecked: now() }));
        autoUpdater.on('download-progress', p => {
            if (state.status !== 'downloading' || !p) return;
            const percent = Math.max(0, Math.min(100, Number(p.percent) || 0));
            if (Math.floor(percent) === lastPercent && percent < 100) return;
            lastPercent = Math.floor(percent);
            set({ progress: { percent, transferred: Number(p.transferred) || 0, total: Number(p.total) || 0, bytesPerSecond: Number(p.bytesPerSecond) || 0 } });
        });
        autoUpdater.on('update-downloaded', () => {
            if (state.status !== 'downloading') return;
            set({ status: 'downloaded', progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 } });
        });
        autoUpdater.on('error', err => setError(err));
    }

    function onAvailable(info) {
        const v = info && info.version;
        if (!version.isValid(v)) {
            return set({ status: 'error', error: { code: 'UPDATE_BAD_VERSION', message: 'Invalid version in update feed' }, info: null, lastChecked: now() });
        }
        if (version.compare(v, currentVersion) <= 0) {
            // never "update" to the same or an older version
            return set({ status: 'not-available', info: null, error: null, lastChecked: now() });
        }
        set({
            status: 'available',
            info: { version: v, notes: notesToText(info.releaseNotes), releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null },
            progress: null, error: null, lastChecked: now()
        });
    }

    async function check() {
        if (state.status === 'disabled') throw new HubError('UPDATE_DISABLED', 'Updates are not available in this build', { reason: state.disabledReason });
        if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded' || restarting) return getState();
        set({ status: 'checking', error: null });
        try {
            const res = await autoUpdater.checkForUpdates();
            // Some versions only resolve; make sure we are not left in "checking".
            if (state.status === 'checking') {
                if (res && res.updateInfo && res.isUpdateAvailable !== false) onAvailable(res.updateInfo);
                else set({ status: 'not-available', info: null, lastChecked: now() });
            }
        } catch (e) { setError(e); }
        return getState();
    }

    async function download() {
        // also allowed after a failed/interrupted download, so the user can retry
        const retry = state.status === 'error' && state.info;
        if (state.status !== 'available' && !retry) throw new HubError('UPDATE_NOT_AVAILABLE', 'There is no update to download');
        lastPercent = -1;
        set({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, error: null });
        try {
            await autoUpdater.downloadUpdate();
            if (state.status === 'downloading') set({ status: 'downloaded' });
        } catch (e) {
            setError(e); // keeps `info`, so the UI offers "Download" again
        }
        return getState();
    }

    // Restarting needs an explicit confirmation from the user (flag set by the
    // UI after its confirmation dialog) and no tool operation in progress.
    function installAndRestart(opts2) {
        if (!opts2 || opts2.confirmed !== true) throw new HubError('UPDATE_NOT_CONFIRMED', 'The user has not confirmed the restart');
        if (state.status !== 'downloaded') throw new HubError('UPDATE_NOT_READY', 'No downloaded update to install');
        if (!canInstall()) throw new HubError('UPDATE_BUSY', 'A tool operation is in progress');
        if (restarting) return getState();
        restarting = true;
        try {
            autoUpdater.quitAndInstall(true, true); // silent install, relaunch afterwards
        } catch (e) {
            restarting = false;
            setError(new HubError('UPDATE_INSTALL_FAILED', e && e.message));
            throw new HubError('UPDATE_INSTALL_FAILED', e && e.message);
        }
        return getState();
    }

    return { getState, check, download, installAndRestart, on: (ev, fn) => emitter.on(ev, fn) };
}

module.exports = { createUpdateService, notesToText, parseFeedConfig, isFeedConfigured, classifyError };
