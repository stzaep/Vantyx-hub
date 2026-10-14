'use strict';
// Tool kind: Adobe CEP extension (HTML panel + ExtendScript host).
// Phase 1 installs per user (no admin needed): %APPDATA%\Adobe\CEP\extensions
const path = require('path');
const { HubError } = require('../core/errors');
const cepDebug = require('../core/cep-debug');

module.exports = {
    id: 'cep',
    label: 'CEP extension',

    // Returns the normalized kind-specific part of the manifest.
    validateManifest(m, problems) {
        const c = m.cep;
        if (c !== undefined && (c === null || typeof c !== 'object' || Array.isArray(c))) {
            problems.push('"cep" must be an object');
            return {};
        }
        return { cep: { requiresDebugMode: !c || c.requiresDebugMode !== false } };
    },

    validatePayload(files) {
        const f = files.find(x => x.path === 'CSXS/manifest.xml');
        if (!f) throw new HubError('PAYLOAD_INVALID', 'CEP payload must contain CSXS/manifest.xml');
        if (!/ExtensionBundleId\s*=/.test(f.read().toString('utf8'))) {
            throw new HubError('PAYLOAD_INVALID', 'CSXS/manifest.xml has no ExtensionBundleId');
        }
    },

    getTargets(env) {
        return [{
            key: 'user',
            label: 'Current user',
            root: path.join(env.appData, 'Adobe', 'CEP', 'extensions'),
            needsAdmin: false,
            available: true
        }];
    },

    async afterInstall(ctx) {
        if (!ctx.manifest.cep || !ctx.manifest.cep.requiresDebugMode) return { debugMode: 'not-required' };
        const r = await cepDebug.enable({ runner: ctx.runner, platform: ctx.env.platform });
        return { debugMode: r.skipped ? 'skipped' : (r.errors.length ? 'partial' : 'enabled'), debugDetails: r };
    }
};
