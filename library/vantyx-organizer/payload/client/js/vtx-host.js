// =========================================================
//  Vantyx Organizer - client/js/vtx-host.js
//  Puente panel -> ExtendScript. Todas las llamadas devuelven
//  (err, data); el host responde siempre con un sobre JSON.
//  El transporte es ASCII puro (\uXXXX) para evitar problemas
//  de codificación en nombres con acentos, emojis, etc.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var cs = (typeof VantyxCSInterface !== 'undefined') ? new VantyxCSInterface() : null;

    // JSON -> literal ExtendScript seguro (solo ASCII)
    function ascii(json) {
        return json.replace(/[\u007f-\uffff]/g, function (c) {
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        });
    }
    function lit(v) { return ascii(JSON.stringify(v)); }

    function call(fn, args, cb) {
        if (!cs) return cb({ code: 'NO_CEP', message: 'CEP interface not available' });
        var script = fn + '(' + (args || []).map(lit).join(',') + ')';
        cs.evalScript(script, function (res) {
            if (res === 'EvalScript error.' || res === undefined || res === null || res === 'undefined' || res === '') {
                return cb({ code: 'HOST_NOT_LOADED', message: 'Host script not loaded' });
            }
            var env;
            try { env = JSON.parse(res); } catch (e) { return cb({ code: 'BAD_RESPONSE', message: String(res).substring(0, 160) }); }
            if (env && env.ok) return cb(null, env.data);
            cb({ code: 'HOST_ERROR', message: (env && env.error) || 'Unknown error', line: env && env.line });
        });
    }

    var EXPECTED = '1.0.4';

    // Comprueba que el host esta cargado y es la version esperada; si no,
    // fija VTXO_BASE (ruta absoluta de la extension) y lo evalua de nuevo.
    // Si sigue sin cargar, el error incluye el motivo real (archivo que
    // falta, error de sintaxis con su linea, etc.).
    function ensureLoaded(cb) {
        call('VTXO_ping', [], function (err, data) {
            if (!err && data && data.version === EXPECTED && !(data.failed && data.failed.length)) return cb(null, data);
            var p = cs && cs.getExtensionPath();
            if (!p) return cb(err || { code: 'NO_EXT_PATH', message: 'getSystemPath(extension) is empty' });
            var main = p + '/host/vtx-main.jsx';
            var boot = '(function(){' +
                '$.global.VTXO_BASE=' + lit(p) + ';' +
                'var f=new File(' + lit(main) + ');' +
                'if(!f.exists){var h=new Folder(' + lit(p + '/host') + ');' +
                  'return "NOFILE "+f.fsName+" | host dir: "+(h.exists?h.getFiles().join(", "):"missing");}' +
                'try{$.evalFile(f);return "OK";}catch(e){return "ERR "+e+" @"+e.line;}' +
                '})()';
            cs.evalScript(boot, function (bootRes) {
                call('VTXO_ping', [], function (err2, data2) {
                    if (err2) return cb({ code: err2.code, message: 'load: ' + String(bootRes).substring(0, 300) + ' | path: ' + p });
                    if (data2 && data2.failed && data2.failed.length) return cb({ code: 'MODULES_FAILED', message: data2.failed.join(', ') });
                    cb(null, data2);
                });
            });
        });
    }

    VTX.host = { call: call, ensureLoaded: ensureLoaded, ascii: ascii };
})(window);
