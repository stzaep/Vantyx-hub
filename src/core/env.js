'use strict';
const os = require('os');
const path = require('path');

// Everything that depends on the machine lives here so tests can inject a
// fake environment.
function getEnv(overrides) {
    const e = process.env;
    const home = e.USERPROFILE || os.homedir();
    const env = {
        platform: process.platform,
        home,
        appData: e.APPDATA || path.join(home, 'AppData', 'Roaming'),
        localAppData: e.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        programFiles: e.ProgramFiles || 'C:\\Program Files',
        programFilesX86: e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    };
    Object.assign(env, overrides || {});
    env.vars = {
        APPDATA: env.appData,
        LOCALAPPDATA: env.localAppData,
        USERPROFILE: env.home,
        PROGRAMFILES: env.programFiles
    };
    return env;
}

module.exports = { getEnv };
