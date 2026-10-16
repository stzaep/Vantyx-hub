'use strict';
// Hub preferences, stored in <dataDir>/settings.json (the same folder as the
// install receipts). The NSIS uninstaller and every update leave this folder
// alone, so preferences survive updates and reinstalls.
//
// Only keys listed in SCHEMA can be changed. Unknown keys already in the file
// (e.g. written by a newer version) are preserved when saving.
const fs = require('fs');
const path = require('path');
const { HubError } = require('./errors');

const DEFAULTS = Object.freeze({ autoCheckUpdates: true, discordRichPresence: false });
const SCHEMA = Object.freeze({ autoCheckUpdates: 'boolean', discordRichPresence: 'boolean' });

function createSettings({ dir, fileName = 'settings.json' }) {
    const file = path.join(dir, fileName);
    let known = null;
    let extra = {};

    function load() {
        let raw = {};
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
        } catch (e) { /* missing or corrupt file -> defaults */ }
        known = { ...DEFAULTS };
        extra = {};
        for (const k of Object.keys(raw)) {
            if (Object.prototype.hasOwnProperty.call(SCHEMA, k)) {
                if (typeof raw[k] === SCHEMA[k]) known[k] = raw[k];
            } else if (k !== '__proto__') extra[k] = raw[k];
        }
    }

    function save() {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ ...extra, ...known }, null, 2));
        fs.renameSync(tmp, file);
    }

    function get() {
        if (!known) load();
        return { ...known };
    }

    function set(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new HubError('BAD_REQUEST', 'Invalid settings');
        const keys = Object.keys(patch);
        if (!keys.length) throw new HubError('BAD_REQUEST', 'Invalid settings');
        for (const k of keys) {
            if (!Object.prototype.hasOwnProperty.call(SCHEMA, k)) throw new HubError('BAD_REQUEST', 'Unknown setting: ' + k);
            if (typeof patch[k] !== SCHEMA[k]) throw new HubError('BAD_REQUEST', 'Invalid value for ' + k);
        }
        if (!known) load();
        Object.assign(known, patch);
        save();
        return { ...known };
    }

    return { get, set, file };
}

module.exports = { createSettings, DEFAULTS, SCHEMA };
