// =========================================================
//  Vantyx Organizer - client/js/vtx-storage.js
//  Guardado automático con doble respaldo:
//    1) localStorage del panel (inmediato)
//    2) config.json en <userData>/VantyxOrganizer (sobrevive a
//       limpiezas de caché del navegador embebido)
//  Al abrir se usa la copia más reciente (savedAt).
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var KEY = 'vantyx_organizer_state_v1';
    var DEBOUNCE_MS = 350;

    var timer = null, writing = false, dirty = false, latest = null;
    var info = { path: '', disk: null };   // disk: null=desconocido, true/false

    function readLocal() {
        try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }
    function writeLocal(cfg) {
        try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; }
    }
    function newest(a, b) {
        if (!a) return b; if (!b) return a;
        return (Number(a.savedAt) || 0) >= (Number(b.savedAt) || 0) ? a : b;
    }

    function load(cb) {
        var done = false, local = readLocal();
        var guard = setTimeout(function () { finish(null); }, 3500);
        function finish(disk) {
            if (done) return; done = true; clearTimeout(guard);
            cb(newest(disk, local));
        }
        VTX.host.ensureLoaded(function (err) {
            if (err) { info.disk = false; return finish(null); }
            VTX.host.call('VTXO_readConfig', [], function (err2, data) {
                if (err2 || !data) { info.disk = false; return finish(null); }
                info.path = data.path || '';
                info.disk = true;
                var disk = null;
                if (data.text) { try { disk = JSON.parse(data.text); } catch (e) { disk = null; } }
                finish(disk);
            });
        });
    }

    function pump() {
        if (writing || !dirty || !latest) return;
        writing = true; dirty = false;
        var text = VTX.host.ascii(JSON.stringify(latest));
        VTX.host.call('VTXO_writeConfig', [text], function (err, data) {
            writing = false;
            info.disk = !err;
            if (!err && data && data.path) info.path = data.path;
            if (VTX.storage.onStatus) VTX.storage.onStatus(info);
            pump();                      // si hubo cambios durante la escritura, vuelve a guardar
        });
    }

    function save(cfg) {
        latest = cfg;
        writeLocal(cfg);                 // inmediato
        dirty = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; pump(); }, DEBOUNCE_MS);
    }

    function flush() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (latest) writeLocal(latest);
        pump();
    }

    function describe() {
        if (info.disk === true) return 'Saved automatically · ' + (info.path || 'config.json');
        if (info.disk === false) return 'Saved in this panel only (disk backup unavailable). Enable "Allow Scripts to Write Files and Access Network" in After Effects preferences for a permanent backup file.';
        return 'Checking storage…';
    }

    VTX.storage = { load: load, save: save, flush: flush, describe: describe, onStatus: null };

    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
})(window);
