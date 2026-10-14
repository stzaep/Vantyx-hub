// =========================================================
//  Vantyx Organizer - host/modules/scan.jsx
//  Inventario del panel Project. SOLO LEE: no modifica nada.
//  Devuelve hechos crudos de cada item; la clasificacion
//  (reglas del usuario) vive en el panel (client/js).
// =========================================================
var VTXO = (typeof $.global.VTXO === 'undefined') ? ($.global.VTXO = {}) : $.global.VTXO;

VTXO.scan = (function () {
    function extOf(name) {
        var m = /\.([A-Za-z0-9_]+)$/.exec(String(name || ''));
        return m ? m[1].toLowerCase() : '';
    }

    function describe(it) {
        var rec = { id: it.id, name: it.name, parent: 0, type: 'unknown' };
        try { rec.parent = it.parentFolder ? it.parentFolder.id : 0; } catch (e0) {}

        if (it instanceof FolderItem) {
            rec.type = 'folder';
            return rec;
        }

        if (it instanceof CompItem) {
            rec.type = 'comp';
            rec.used = 0; // en cuantas comps se usa como capa (>0 = precomp)
            try { rec.used = it.usedIn.length; } catch (e1) {}
            return rec;
        }

        if (it instanceof FootageItem) {
            rec.type = 'footage';
            rec.src = 'unknown';   // file | solid | placeholder | unknown
            rec.ext = '';
            rec.still = false;
            rec.hasVideo = false;
            rec.hasAudio = false;
            rec.missing = false;

            try { rec.missing = !!it.footageMissing; } catch (e2) {}
            try { rec.hasVideo = !!it.hasVideo; } catch (e3) {}
            try { rec.hasAudio = !!it.hasAudio; } catch (e4) {}

            var ms = null;
            try { ms = it.mainSource; } catch (e5) {}
            if (ms) {
                if (ms instanceof SolidSource) {
                    rec.src = 'solid';
                } else if (ms instanceof PlaceholderSource) {
                    rec.src = 'placeholder';
                } else if (ms instanceof FileSource) {
                    rec.src = 'file';
                    try { rec.still = !!ms.isStill; } catch (e6) {}
                    try { if (ms.file) rec.ext = extOf(ms.file.name); } catch (e7) {}
                    if (!rec.ext) { try { rec.ext = extOf(ms.missingFootagePath); } catch (e8) {} }
                }
            }
            return rec;
        }

        return rec;
    }

    function run() {
        var proj = app.project;
        var items = [];
        var n = proj.numItems;
        for (var i = 1; i <= n; i++) {
            try { items.push(describe(proj.item(i))); } catch (e) {}
        }
        var rootId = 0;
        try { rootId = proj.rootFolder.id; } catch (eRoot) {}
        var pname = '';
        try { pname = proj.file ? proj.file.name : ''; } catch (eName) {}
        return { rootId: rootId, count: items.length, project: pname, items: items };
    }

    return { run: run };
})();
