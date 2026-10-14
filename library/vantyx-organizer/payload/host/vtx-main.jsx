// =========================================================
//  Vantyx Organizer - host/vtx-main.jsx
//  Module loader + public API called by the panel.
//  Every public function returns a JSON envelope:
//     { ok:true, data:... }  |  { ok:false, error:"...", line:N }
//  NOTE: the JSON helper is defined INLINE here (not in a module),
//  so the envelope always works even if a module fails to load.
//  File is pure ASCII on purpose (ExtendScript guesses encoding).
// =========================================================
$.global.VTXO = (typeof $.global.VTXO === 'undefined') ? {} : $.global.VTXO;
var VTXO = $.global.VTXO;
VTXO.VERSION = '1.0.4';
VTXO.loaded = [];
VTXO.failed = [];

VTXO.json = (function () {
    var ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

    function quote(s) {
        return '"' + String(s).replace(/[\\"\u0000-\u001f\u007f-\uffff]/g, function (c) {
            if (ESC.hasOwnProperty(c)) return ESC[c];
            var h = c.charCodeAt(0).toString(16);
            while (h.length < 4) h = '0' + h;
            return '\\u' + h;
        }) + '"';
    }

    function stringify(v) {
        if (v === null || v === undefined) return 'null';
        var t = typeof v;
        if (t === 'boolean') return v ? 'true' : 'false';
        if (t === 'number') return isFinite(v) ? String(v) : 'null';
        if (t === 'string') return quote(v);
        if (Object.prototype.toString.call(v) === '[object Array]') {
            var items = [];
            for (var i = 0; i < v.length; i++) items.push(stringify(v[i]));
            return '[' + items.join(',') + ']';
        }
        if (t === 'object') {
            var parts = [];
            for (var k in v) {
                if (!v.hasOwnProperty(k)) continue;
                var val = v[k];
                if (val === undefined || typeof val === 'function') continue;
                parts.push(quote(k) + ':' + stringify(val));
            }
            return '{' + parts.join(',') + '}';
        }
        return 'null';
    }

    // Validacion estilo json2 antes de evaluar: si el texto no es JSON
    // puro (solo literales), se rechaza y nunca llega a eval().
    function parse(text) {
        text = String(text);
        var stripped = text
            .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
            .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
            .replace(/(?:^|:|,)(?:\s*\[)+/g, '');
        if (/^[\],:{}\s]*$/.test(stripped)) {
            return eval('(' + text + ')');
        }
        throw new Error('INVALID_JSON');
    }

    return { stringify: stringify, parse: parse };
})();

// Minimal, dependency-free escaper used only for last-resort errors.
function VTXO_esc(s) {
    var t = String(s), o = '';
    for (var i = 0; i < t.length; i++) {
        var c = t.charCodeAt(i);
        if (c === 34) o += '\\"';
        else if (c === 92) o += '\\\\';
        else if (c < 32 || c > 126) { var h = c.toString(16); while (h.length < 4) h = '0' + h; o += '\\u' + h; }
        else o += t.charAt(i);
    }
    return o;
}

function VTXO_fatal(e, where) {
    var m = '';
    try { m = String(e && e.message ? e.message : e); } catch (x) { m = 'unknown'; }
    var ln = 0;
    try { ln = (e && e.line) ? e.line : 0; } catch (x2) {}
    return '{"ok":false,"error":"HOST_FATAL (' + where + '): ' + VTXO_esc(m) + '","line":' + ln + '}';
}

VTXO.loadModules = function () {
    var base = null;
    try { if (typeof VTXO_BASE === 'string' && VTXO_BASE.length) base = new Folder(VTXO_BASE + '/host'); } catch (e0) {}
    if (!base) { try { base = File($.fileName).parent; } catch (e1) {} }
    var mods = ['storage', 'scan', 'apply'];
    VTXO.loaded = [];
    VTXO.failed = [];
    for (var i = 0; i < mods.length; i++) {
        if (!base) { VTXO.failed.push(mods[i] + ':NO_BASE_PATH'); continue; }
        var f = new File(base.fsName + '/modules/' + mods[i] + '.jsx');
        if (!f.exists) { VTXO.failed.push(mods[i] + ':NOT_FOUND ' + f.fsName); continue; }
        try {
            $.evalFile(f);
            if ($.global.VTXO && $.global.VTXO[mods[i]]) VTXO.loaded.push(mods[i]);
            else VTXO.failed.push(mods[i] + ':NOT_REGISTERED');
        }
        catch (err) { VTXO.failed.push(mods[i] + ':' + err + (err && err.line ? ' @' + err.line : '')); }
    }
};
VTXO.loadModules();

function VTXO_run(fn) {
    try {
        return VTXO.json.stringify({ ok: true, data: fn() });
    } catch (e) {
        try {
            var msg = String(e && e.message ? e.message : e);
            var line = (e && e.line) ? e.line : 0;
            return VTXO.json.stringify({ ok: false, error: msg, line: line });
        } catch (e2) { return VTXO_fatal(e, 'run'); }
    }
}

function VTXO_need(name) {
    if (!$.global.VTXO || !$.global.VTXO[name]) throw new Error('MODULE_NOT_LOADED: ' + name);
}

function VTXO_ping() {
    return VTXO_run(function () {
        return { version: VTXO.VERSION, loaded: VTXO.loaded, failed: VTXO.failed, ae: String(app.version) };
    });
}

function VTXO_readConfig() {
    return VTXO_run(function () { VTXO_need('storage'); return VTXO.storage.read(); });
}

function VTXO_writeConfig(text) {
    return VTXO_run(function () { VTXO_need('storage'); return VTXO.storage.write(text); });
}

function VTXO_scanProject() {
    return VTXO_run(function () { VTXO_need('scan'); return VTXO.scan.run(); });
}

function VTXO_applyPlan(planJson) {
    return VTXO_run(function () { VTXO_need('apply'); return VTXO.apply.run(VTXO.json.parse(planJson)); });
}
