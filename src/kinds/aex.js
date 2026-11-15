'use strict';
// Native Windows After Effects plug-in (.aex), installed into Plug-ins/Vantyx.
const { HubError } = require('../core/errors');
const { detectAfterEffects } = require('../core/ae-detect');

module.exports = {
    id: 'aex',
    label: 'Native AE plugin',
    validateManifest() { return {}; },
    validatePayload(files) {
        const aex = files.filter(f => /^VTX-Console\.aex$/i.test(f.path));
        if (aex.length !== 1 || files.length !== 1) {
            throw new HubError('PAYLOAD_INVALID', 'AEX payload must contain exactly one file named VTX-Console.aex');
        }
    },
    getTargets(env) {
        if (env.platform !== 'win32') return [];
        return detectAfterEffects(env).map(ae => ({
            key: 'ae-' + ae.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            label: ae.name,
            root: ae.plugInsDir,
            installDir: 'Vantyx',
            needsAdmin: true,
            available: true,
            aeLabel: ae.label
        }));
    }
};
