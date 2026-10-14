// =========================================================
//  Vantyx Organizer - host/modules/apply.jsx
//  Ejecuta un plan { moves: [ { id, folder } ] }.
//  Garantias:
//   - Solo MUEVE items (item.parentFolder = carpeta). Nunca
//     elimina, duplica, renombra ni reimporta nada.
//   - Reutiliza carpetas existentes (mismo nombre, sin
//     distinguir mayusculas) en lugar de crear duplicadas.
//   - Las carpetas se crean solo cuando hay algo que meter.
//   - Todo va en UN grupo de deshacer (Ctrl+Z lo revierte).
//   - Las carpetas del proyecto nunca se mueven.
// =========================================================
var VTXO = (typeof $.global.VTXO === 'undefined') ? ($.global.VTXO = {}) : $.global.VTXO;

VTXO.apply = (function () {
    var MAX_ERRORS = 20;

    // "A/B / C" -> ["A","B","C"]
    function cleanPath(p) {
        var segs = String(p || '').split('/');
        var out = [];
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i].replace(/[\u0000-\u001f]/g, '').replace(/^\s+|\s+$/g, '');
            if (s.length) out.push(s.substring(0, 60));
        }
        return out;
    }

    function findChildFolder(parent, name) {
        var low = name.toLowerCase();
        var n = parent.numItems;
        for (var i = 1; i <= n; i++) {
            var c = parent.item(i);
            if (c instanceof FolderItem && String(c.name).toLowerCase() === low) return c;
        }
        return null;
    }

    function createFolder(parent, name) {
        var proj = app.project;
        var f = proj.items.addFolder(name);        // siempre nace en la raiz
        if (parent.id !== proj.rootFolder.id) f.parentFolder = parent;
        return f;
    }

    function resolvePath(segs, cache, created) {
        var parent = app.project.rootFolder;
        var key = '';
        for (var i = 0; i < segs.length; i++) {
            key += '/' + segs[i].toLowerCase();
            if (cache.hasOwnProperty(key)) { parent = cache[key]; continue; }
            var f = findChildFolder(parent, segs[i]);
            if (!f) {
                f = createFolder(parent, segs[i]);
                created.push(segs.slice(0, i + 1).join('/'));
            }
            cache[key] = f;
            parent = f;
        }
        return parent;
    }

    function run(plan) {
        var proj = app.project;
        var moves = (plan && plan.moves) ? plan.moves : [];
        var res = { moved: 0, alreadyThere: 0, missing: 0, skipped: 0, created: [], errors: [] };
        if (moves.length === 0) return res;

        // Mapa id -> item, una sola pasada por el proyecto.
        var byId = {};
        var n = proj.numItems;
        for (var i = 1; i <= n; i++) {
            var it = proj.item(i);
            byId['i' + it.id] = it;
        }

        var cache = {};
        app.beginUndoGroup('Vantyx Organizer');
        try {
            for (var m = 0; m < moves.length; m++) {
                var mv = moves[m];
                try {
                    var item = byId['i' + mv.id];
                    if (!item) { res.missing++; continue; }
                    if (item instanceof FolderItem) { res.skipped++; continue; }

                    var segs = cleanPath(mv.folder);
                    if (segs.length === 0) { res.skipped++; continue; }

                    var target = resolvePath(segs, cache, res.created);
                    if (item.parentFolder && item.parentFolder.id === target.id) { res.alreadyThere++; continue; }

                    item.parentFolder = target;
                    res.moved++;
                } catch (eMove) {
                    res.skipped++;
                    if (res.errors.length < MAX_ERRORS) {
                        res.errors.push({ id: mv.id, message: String(eMove && eMove.message ? eMove.message : eMove) });
                    }
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return res;
    }

    return { run: run, cleanPath: cleanPath };
})();
