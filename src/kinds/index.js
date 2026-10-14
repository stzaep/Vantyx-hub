'use strict';
// Registry of tool kinds. To support a new kind (e.g. ScriptUI panels) add a
// module with the same interface as cep.js and register it here.
const { HubError } = require('../core/errors');
const kinds = { cep: require('./cep') };

function get(id) {
    const k = kinds[id];
    if (!k) throw new HubError('UNKNOWN_KIND', 'Unknown tool kind: ' + id);
    return k;
}
const has = id => Object.prototype.hasOwnProperty.call(kinds, id);

module.exports = { get, has, ids: () => Object.keys(kinds) };
