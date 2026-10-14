// =========================================================
//  Vantyx Organizer - client/js/vtx-state.js
//  Configuración en memoria: presets, categorías, opciones.
//  Toda mutación termina en commit(), que avisa a los
//  suscriptores (el almacenamiento guarda automáticamente).
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};

    var cfg = null, listeners = [];
    var KIND_IDS = {}, MODE_IDS = {}, SCOPE_IDS = {};
    VTX.KINDS.forEach(function (k) { KIND_IDS[k.id] = true; });
    VTX.NAME_MODES.forEach(function (m) { MODE_IDS[m.id] = true; });
    VTX.SCOPES.forEach(function (s) { SCOPE_IDS[s.id] = true; });

    function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function str(v, d) { return typeof v === 'string' ? v : d; }

    // ---------- saneado (migra y repara configuraciones antiguas o dañadas) ----------
    function sanitizeCategory(c) {
        c = (c && typeof c === 'object') ? c : {};
        var kinds = [], seen = {};
        (Array.isArray(c.kinds) ? c.kinds : []).forEach(function (k) {
            if (KIND_IDS[k] && !seen[k]) { seen[k] = true; kinds.push(k); }
        });
        var exts = Array.isArray(c.extensions) ? VTX.classifier.parseExtList(c.extensions.join(',')) : [];
        var nr = (c.nameRule && typeof c.nameRule === 'object') ? c.nameRule : {};
        return {
            id: str(c.id, '') || uid('c'),
            name: str(c.name, ''),
            enabled: c.enabled !== false,
            kinds: kinds,
            extensions: exts,
            nameRule: { mode: MODE_IDS[nr.mode] ? nr.mode : 'none', value: str(nr.value, '') }
        };
    }

    function sanitizeOptions(o) {
        var d = VTX.defaults.options();
        o = (o && typeof o === 'object') ? o : {};
        var fb = (o.fallback && typeof o.fallback === 'object') ? o.fallback : {};
        return {
            scope: SCOPE_IDS[o.scope] ? o.scope : d.scope,
            fallback: { enabled: fb.enabled === true, name: str(fb.name, d.fallback.name) },
            previewBeforeOrganize: o.previewBeforeOrganize === true
        };
    }

    function sanitizePreset(p) {
        p = (p && typeof p === 'object') ? p : {};
        var cats = Array.isArray(p.categories) ? p.categories.map(sanitizeCategory) : VTX.defaults.categories();
        var ids = {};
        cats.forEach(function (c) { if (ids[c.id]) c.id = uid('c'); ids[c.id] = true; });
        return { id: str(p.id, '') || uid('p'), name: str(p.name, '').replace(/^\s+|\s+$/g, '') || 'Preset', categories: cats, options: sanitizeOptions(p.options) };
    }

    function normalize(raw) {
        if (!raw || typeof raw !== 'object') return VTX.defaults.config();
        var ui = (raw.ui && typeof raw.ui === 'object') ? raw.ui : {};
        var out = {
            version: 1,
            savedAt: Number(raw.savedAt) || 0,
            ui: { theme: ui.theme === 'light' ? 'light' : 'dark', collapsed: (ui.collapsed && typeof ui.collapsed === 'object') ? ui.collapsed : {} },
            activePresetId: str(raw.activePresetId, ''),
            presets: (Array.isArray(raw.presets) ? raw.presets : []).map(sanitizePreset)
        };
        if (!out.presets.length) out.presets = [VTX.defaults.preset('general', 'General')];
        var ids = {}, names = {};
        out.presets.forEach(function (p) {
            if (ids[p.id]) p.id = uid('p');
            ids[p.id] = true;
            p.name = uniqueName(out.presets, p.name, p, names);
            names[p.name.toLowerCase()] = true;
        });
        if (!ids[out.activePresetId]) out.activePresetId = out.presets[0].id;
        return out;
    }

    function uniqueName(list, name, self, taken) {
        var base = name, n = 2, low;
        function used(l) {
            if (taken) return !!taken[l];
            return list.some(function (p) { return p !== self && p.name.toLowerCase() === l; });
        }
        while (used(low = name.toLowerCase())) name = base + ' ' + (n++);
        return name;
    }

    // ---------- API ----------
    function commit() {
        cfg.savedAt = Date.now();
        listeners.forEach(function (fn) { try { fn(cfg); } catch (e) {} });
    }

    function active() {
        for (var i = 0; i < cfg.presets.length; i++) if (cfg.presets[i].id === cfg.activePresetId) return cfg.presets[i];
        return cfg.presets[0];
    }

    VTX.state = {
        init: function (raw) { cfg = normalize(raw); return cfg; },
        get: function () { return cfg; },
        preset: active,
        onChange: function (fn) { listeners.push(fn); },
        commit: commit,
        normalize: normalize,

        // presets
        setActive: function (id) {
            if (cfg.presets.some(function (p) { return p.id === id; })) { cfg.activePresetId = id; commit(); }
        },
        addPreset: function (name) {
            var p = VTX.defaults.preset(uid('p'), '');
            p.name = uniqueName(cfg.presets, (name || '').replace(/^\s+|\s+$/g, '') || 'New Preset', null);
            cfg.presets.push(p); cfg.activePresetId = p.id; commit(); return p;
        },
        duplicatePreset: function (name) {
            var src = active(), p = clone(src);
            p.id = uid('p');
            p.categories.forEach(function (c) { c.id = uid('c'); });
            p.name = uniqueName(cfg.presets, (name || '').replace(/^\s+|\s+$/g, '') || (src.name + ' copy'), null);
            cfg.presets.push(p); cfg.activePresetId = p.id; commit(); return p;
        },
        renamePreset: function (name) {
            var p = active(), n = (name || '').replace(/^\s+|\s+$/g, '');
            if (!n) return false;
            p.name = uniqueName(cfg.presets, n, p); commit(); return true;
        },
        deletePreset: function () {
            if (cfg.presets.length <= 1) return false;
            var p = active(), i = cfg.presets.indexOf(p);
            cfg.presets.splice(i, 1);
            cfg.activePresetId = cfg.presets[Math.max(0, i - 1)].id;
            commit(); return true;
        },
        resetPreset: function () {
            var p = active();
            p.categories = VTX.defaults.categories(); p.options = VTX.defaults.options(); commit();
        },

        // categorías del preset activo
        addCategory: function () {
            var c = sanitizeCategory({ name: 'New Folder', enabled: true });
            active().categories.push(c); commit(); return c;
        },
        moveCategory: function (id, delta) {
            var list = active().categories, i = -1;
            list.forEach(function (c, k) { if (c.id === id) i = k; });
            var j = i + delta;
            if (i < 0 || j < 0 || j >= list.length) return false;
            var t = list[i]; list[i] = list[j]; list[j] = t; commit(); return true;
        },
        removeCategory: function (id) {
            var list = active().categories;
            for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); commit(); return true; }
            return false;
        },

        // interfaz
        setTheme: function (t) { cfg.ui.theme = (t === 'light') ? 'light' : 'dark'; commit(); },
        setCollapsed: function (key, v) { cfg.ui.collapsed[key] = !!v; commit(); }
    };
})(typeof window !== 'undefined' ? window : global);
