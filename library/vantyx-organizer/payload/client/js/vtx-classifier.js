// =========================================================
//  Vantyx Organizer - client/js/vtx-classifier.js
//  Motor de reglas. Sin DOM ni After Effects: recibe el
//  inventario del proyecto + el preset activo y devuelve un
//  plan (qué item va a qué carpeta). No ejecuta nada.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};

    function toSet(arr) { var o = {}; for (var i = 0; i < arr.length; i++) o[arr[i]] = true; return o; }
    var VIDEO = toSet(VTX.EXT.video), AUDIO = toSet(VTX.EXT.audio), IMAGE = toSet(VTX.EXT.image), VECTOR = toSet(VTX.EXT.vector);

    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }

    // "PNG, .jpg ,mov" -> ["png","jpg","mov"]
    function parseExtList(str) {
        var parts = String(str || '').split(/[,;\s]+/), out = [], seen = {};
        for (var i = 0; i < parts.length; i++) {
            var e = parts[i].replace(/^\.+/, '').toLowerCase();
            if (e && !seen[e]) { seen[e] = true; out.push(e); }
        }
        return out;
    }

    // "Assets / Video" -> "Assets/Video"  (vacío si no queda nada válido)
    function normalizePath(name) {
        var segs = String(name || '').split('/'), out = [];
        for (var i = 0; i < segs.length; i++) {
            var s = trim(segs[i].replace(/[\u0000-\u001f]/g, ''));
            if (s) out.push(s.substring(0, 60));
        }
        return out.join('/');
    }

    // Tipo principal de un item (excluyente).
    function detectKind(rec) {
        if (rec.type === 'comp') return rec.used > 0 ? 'precomp' : 'comp';
        if (rec.type !== 'footage') return 'other';
        if (rec.src === 'solid') return 'solid';
        if (rec.src === 'placeholder') return 'placeholder';
        if (rec.src !== 'file') return 'other';

        var ext = rec.ext || '';
        // Con el origen presente, los flags reales mandan sobre la extensión.
        if (!rec.missing && rec.hasAudio && !rec.hasVideo) return 'audio';
        if (AUDIO[ext]) return 'audio';
        if (VECTOR[ext]) return 'vector';
        if (ext === 'gif') return rec.still ? 'image' : 'video';
        if (VIDEO[ext]) return 'video';
        if (IMAGE[ext]) {
            if (rec.missing) return 'image';
            return rec.still ? 'image' : 'sequence';
        }
        if (!rec.missing) {
            if (rec.hasVideo) return rec.still ? 'image' : 'video';
            if (rec.hasAudio) return 'audio';
        }
        return 'other';
    }

    // Etiquetas del item: tipo principal (+ "missing" si falta el archivo).
    function tagsOf(rec) {
        var tags = [detectKind(rec)];
        if (rec.type === 'footage' && rec.src === 'file' && rec.missing) tags.push('missing');
        return tags;
    }

    function nameRuleActive(r) {
        return !!(r && r.mode && r.mode !== 'none' && trim(r.value || ''));
    }

    function regexError(value) {
        try { new RegExp(value, 'i'); return ''; } catch (e) { return String(e.message || e); }
    }

    function nameTest(name, rule) {
        if (!nameRuleActive(rule)) return true;
        var n = String(name).toLowerCase();
        if (rule.mode === 'regex') {
            try { return new RegExp(rule.value, 'i').test(name); } catch (e) { return false; }
        }
        var terms = String(rule.value).split(',');
        for (var i = 0; i < terms.length; i++) {
            var t = trim(terms[i]).toLowerCase();
            if (!t) continue;
            if (rule.mode === 'contains' && n.indexOf(t) >= 0) return true;
            if (rule.mode === 'startsWith' && n.indexOf(t) === 0) return true;
            if (rule.mode === 'endsWith' && n.length >= t.length && n.lastIndexOf(t) === n.length - t.length) return true;
        }
        return false;
    }

    // ¿Esta categoría acepta este item?
    //   (tipo ∈ kinds  O  extensión ∈ extensions)  Y  filtro de nombre.
    // Sin tipos ni extensiones => solo cuenta el filtro de nombre.
    // Sin ningún criterio => no acepta nada (evita mover todo por error).
    function matches(rec, tags, c) {
        var kinds = c.kinds || [], exts = c.extensions || [];
        var hasKinds = kinds.length > 0, hasExt = exts.length > 0, hasName = nameRuleActive(c.nameRule);
        if (!hasKinds && !hasExt && !hasName) return false;

        var base = true;
        if (hasKinds || hasExt) {
            base = false;
            var i;
            if (hasKinds) for (i = 0; i < tags.length; i++) if (kinds.indexOf(tags[i]) >= 0) base = true;
            if (!base && hasExt && rec.type === 'footage' && rec.ext && exts.indexOf(rec.ext) >= 0) base = true;
        }
        return base && (!hasName || nameTest(rec.name, c.nameRule));
    }

    // Ruta "A/B" de la carpeta con ese id ('' = raíz).
    function makePathResolver(inv) {
        var folders = {}, cache = {};
        inv.items.forEach(function (r) { if (r.type === 'folder') folders[r.id] = r; });
        return function pathOf(id) {
            if (id === inv.rootId || id === 0 || !folders[id]) return '';
            if (cache[id] !== undefined) return cache[id];
            var parts = [], cur = id, guard = 0;
            while (cur !== inv.rootId && cur !== 0 && folders[cur] && guard++ < 64) {
                parts.unshift(folders[cur].name);
                cur = folders[cur].parent;
            }
            return (cache[id] = parts.join('/'));
        };
    }

    function buildPlan(inv, preset) {
        var opts = preset.options || {}, fb = opts.fallback || {};
        var pathOf = makePathResolver(inv);
        var cats = [];
        (preset.categories || []).forEach(function (c) {
            var p = normalizePath(c.name);
            if (c.enabled && p) cats.push({ c: c, path: p });
        });
        var fbPath = fb.enabled ? normalizePath(fb.name) : '';

        var stats = { total: 0, inScope: 0, moves: 0, alreadyOk: 0, unmatched: 0, outOfScope: 0 };
        var moves = [];

        inv.items.forEach(function (rec) {
            if (rec.type === 'folder' || rec.type === 'unknown') return;
            stats.total++;
            if (opts.scope !== 'all' && rec.parent !== inv.rootId) { stats.outOfScope++; return; }
            stats.inScope++;

            var tags = tagsOf(rec), target = '', catName = '';
            for (var i = 0; i < cats.length; i++) {
                if (matches(rec, tags, cats[i].c)) { target = cats[i].path; catName = cats[i].c.name; break; }
            }
            if (!target && fbPath) { target = fbPath; catName = fb.name; }
            if (!target) { stats.unmatched++; return; }

            var current = pathOf(rec.parent);
            if (current.toLowerCase() === target.toLowerCase()) { stats.alreadyOk++; return; }

            moves.push({ id: rec.id, name: rec.name, kind: tags[0], from: current || '(root)', to: target, category: trim(catName) });
        });
        stats.moves = moves.length;

        var groups = [], index = {};
        moves.forEach(function (m) {
            var key = m.to.toLowerCase();
            if (index[key] === undefined) { index[key] = groups.length; groups.push({ path: m.to, category: m.category, items: [] }); }
            groups[index[key]].items.push(m);
        });
        return { moves: moves, groups: groups, stats: stats };
    }

    VTX.classifier = {
        parseExtList: parseExtList, normalizePath: normalizePath, detectKind: detectKind, tagsOf: tagsOf,
        nameTest: nameTest, nameRuleActive: nameRuleActive, regexError: regexError,
        matches: matches, buildPlan: buildPlan
    };
})(typeof window !== 'undefined' ? window : global);
