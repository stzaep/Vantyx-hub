// =========================================================
//  Vantyx Organizer - client/js/vtx-ui-settings.js
//  Panel de ajustes: presets, categorías/reglas, opciones,
//  apariencia. Cada cambio se guarda solo (state.commit).
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var ui = VTX.ui, el = ui.el;
    var openCards = {};          // categoría abierta/cerrada (solo memoria)
    var rulesList = null;

    var ICON = {
        presets: '<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5"></rect><rect x="3" y="14" width="18" height="6" rx="1.5"></rect></svg>',
        rules:   '<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="4" cy="6" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="18" r="1"></circle></svg>',
        options: '<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line></svg>',
        look:    '<svg class="category-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line></svg>',
        dup:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>',
        up:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>',
        down:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        trash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>'
    };

    function commit() { VTX.state.commit(); }

    function init() {
        ui.$('btnBack').addEventListener('click', close);
        render();
    }
    function open() { render(); ui.showView('settings'); }
    function close() { ui.showView('main'); VTX.uiMain.render(); }

    function section(key, title, icon, content) {
        var frag = document.createDocumentFragment();
        var head = el('div', 'category-header collapsible-toggle');
        var label = el('span', 'category-header-label');
        label.appendChild(ui.icon(icon)); label.appendChild(document.createTextNode(title));
        head.appendChild(label); head.appendChild(el('span', 'chevron', '▼'));
        var wrap = el('div', 'panel-content'); wrap.appendChild(content);
        ui.bindCollapsible(head, wrap, 's_' + key);
        frag.appendChild(head); frag.appendChild(wrap);
        return frag;
    }

    function iconBtn(cls, svgOrText, title, fn) {
        var b = el('button', cls); b.title = title;
        if (svgOrText.charAt(0) === '<') b.appendChild(ui.icon(svgOrText)); else b.textContent = svgOrText;
        b.addEventListener('click', fn);
        return b;
    }

    function render() {
        var body = ui.$('settingsBody');
        ui.clear(body);
        ui.$('settingsSubtitle').textContent = 'PRESET · ' + VTX.state.preset().name.toUpperCase();
        body.appendChild(section('presets', 'Presets', ICON.presets, buildPresets()));
        body.appendChild(el('div', 'section-divider'));
        body.appendChild(section('rules', 'Folders & Rules', ICON.rules, buildRules()));
        body.appendChild(el('div', 'section-divider'));
        body.appendChild(section('options', 'Options', ICON.options, buildOptions()));
        body.appendChild(el('div', 'section-divider'));
        body.appendChild(section('look', 'Appearance', ICON.look, buildAppearance()));
        ui.applyTheme(VTX.state.get().ui.theme);
    }

    function refreshAll() { render(); VTX.uiMain.render(); }

    // ------------------------------------------------------------ PRESETS
    function buildPresets() {
        var box = el('div'), cfg = VTX.state.get(), cur = VTX.state.preset();
        box.appendChild(el('div', 'block-title', 'Active preset'));
        var row = el('div', 'kit-action-row');
        var wrap = el('div', 'select-wrapper'), sel = el('select', 'vtx-select');
        cfg.presets.forEach(function (p) { var o = el('option', null, p.name); o.value = p.id; o.selected = p.id === cur.id; sel.appendChild(o); });
        sel.addEventListener('change', function () { VTX.state.setActive(sel.value); refreshAll(); });
        wrap.appendChild(sel); row.appendChild(wrap);

        row.appendChild(iconBtn('btn-icon', '+', 'New preset', function () {
            VTX.dialogs.prompt({ title: 'New preset', label: 'Name', value: 'New Preset', okLabel: 'Create' }, function (v) {
                if (v) { VTX.state.addPreset(v); refreshAll(); ui.status('Preset created.'); }
            });
        }));
        row.appendChild(iconBtn('btn-icon', ICON.dup, 'Duplicate preset', function () {
            VTX.dialogs.prompt({ title: 'Duplicate preset', label: 'Name for the copy', value: cur.name + ' copy', okLabel: 'Duplicate' }, function (v) {
                if (v) { VTX.state.duplicatePreset(v); refreshAll(); ui.status('Preset duplicated.'); }
            });
        }));
        row.appendChild(iconBtn('btn-icon', '✏', 'Rename preset', function () {
            VTX.dialogs.prompt({ title: 'Rename preset', label: 'Name', value: cur.name, okLabel: 'Rename' }, function (v) {
                if (v && VTX.state.renamePreset(v)) { refreshAll(); ui.status('Preset renamed.'); }
            });
        }));
        row.appendChild(iconBtn('btn-icon', '🗑', 'Delete preset', function () {
            if (cfg.presets.length <= 1) { ui.status('You must keep at least one preset.'); return; }
            VTX.dialogs.confirm({ title: 'Delete preset', message: 'Delete "' + cur.name + '"? This cannot be undone.', okLabel: 'Delete', danger: true }, function (ok) {
                if (ok && VTX.state.deletePreset()) { refreshAll(); ui.status('Preset deleted.'); }
            });
        }));
        box.appendChild(row);

        box.appendChild(el('div', 'hint', 'Every change you make is saved automatically into the active preset. Use Duplicate to branch a preset before experimenting.'));
        var reset = el('button', 'pill-btn btn-gap', 'Reset this preset to defaults');
        reset.addEventListener('click', function () {
            VTX.dialogs.confirm({ title: 'Reset preset', message: 'Restore the default categories and options of "' + cur.name + '"?', okLabel: 'Reset', danger: true }, function (ok) {
                if (ok) { VTX.state.resetPreset(); refreshAll(); ui.status('Preset reset.'); }
            });
        });
        box.appendChild(reset);
        return box;
    }

    // ------------------------------------------------------------ REGLAS
    function buildRules() {
        var box = el('div');
        var head = el('div', 'section-title-row');
        head.appendChild(el('span', 'section-title', 'Categories'));
        var actions = el('div', 'title-actions');
        actions.appendChild(iconBtn('btn-icon-sm', '+', 'Add category', function () {
            var c = VTX.state.addCategory(); openCards[c.id] = true; renderRules();
            var card = rulesList.lastChild; if (card && card.scrollIntoView) card.scrollIntoView();
        }));
        head.appendChild(actions); box.appendChild(head);
        rulesList = el('div'); box.appendChild(rulesList);
        renderRules();
        box.appendChild(el('div', 'hint', 'Rules run top to bottom and the first active category that matches wins, so order matters. Use "/" in a name for subfolders (e.g. Assets/Video). Existing folders with the same name are reused.'));
        return box;
    }

    function renderRules() {
        ui.clear(rulesList);
        var cats = VTX.state.preset().categories;
        if (!cats.length) rulesList.appendChild(el('div', 'chips-empty', 'No categories yet. Press + to create one.'));
        cats.forEach(function (c, i) { rulesList.appendChild(ruleCard(c, i, cats.length)); });
    }

    function summaryText(c) {
        var parts = [], labels = [];
        VTX.KINDS.forEach(function (k) { if (c.kinds.indexOf(k.id) >= 0) labels.push(k.label); });
        if (labels.length) parts.push(labels.length > 3 ? labels.slice(0, 3).join(', ') + ' +' + (labels.length - 3) : labels.join(', '));
        if (c.extensions.length) parts.push('ext: ' + c.extensions.join(', '));
        if (VTX.classifier.nameRuleActive(c.nameRule)) parts.push('name ' + c.nameRule.mode + ' "' + c.nameRule.value + '"');
        return parts.length ? parts.join(' · ') : 'No criteria yet: matches nothing';
    }

    function ruleCard(c, idx, total) {
        var card = el('div', 'rule-card' + (openCards[c.id] ? ' is-open' : '') + (c.enabled ? '' : ' is-off'));

        // --- cabecera: activar, nombre de carpeta, desplegar
        var head = el('div', 'rule-head');
        head.appendChild(ui.makeSwitch(c.enabled, function (v) { c.enabled = v; card.classList.toggle('is-off', !v); commit(); }));
        var name = el('input', 'rule-name'); name.type = 'text'; name.value = c.name; name.maxLength = 60;
        name.placeholder = 'Folder name (use / for subfolders)';
        function checkName() { name.classList.toggle('is-invalid', !VTX.classifier.normalizePath(name.value)); }
        checkName();
        name.addEventListener('input', function () { c.name = name.value; checkName(); commit(); });
        head.appendChild(name);
        var summary = el('div', 'rule-summary', summaryText(c));
        function refreshSummary() { summary.textContent = summaryText(c); }
        var bodyEl = el('div', 'rule-body'); bodyEl.hidden = !openCards[c.id];
        function toggle() { var o = !openCards[c.id]; openCards[c.id] = o; bodyEl.hidden = !o; card.classList.toggle('is-open', o); }
        head.appendChild(iconBtn('btn-icon-sm rule-expand', '▾', 'Edit rules', toggle));
        summary.style.cursor = 'pointer'; summary.addEventListener('click', toggle);

        // --- tipos de item
        bodyEl.appendChild(el('div', 'block-title', 'Item types'));
        var grid = el('div', 'kind-grid');
        VTX.KINDS.forEach(function (k) {
            var b = el('button', 'kind-chip' + (c.kinds.indexOf(k.id) >= 0 ? ' active' : ''), k.label); b.title = k.hint;
            b.addEventListener('click', function () {
                var i = c.kinds.indexOf(k.id);
                if (i >= 0) c.kinds.splice(i, 1); else c.kinds.push(k.id);
                b.classList.toggle('active', i < 0); refreshSummary(); commit();
            });
            grid.appendChild(b);
        });
        bodyEl.appendChild(grid);

        // --- extensiones extra
        bodyEl.appendChild(el('div', 'block-title', 'Extra file extensions (comma separated)'));
        var ext = el('input', 'text-input field-gap'); ext.type = 'text'; ext.placeholder = 'e.g. mp4, mov, mkv'; ext.value = c.extensions.join(', ');
        ext.addEventListener('input', function () { c.extensions = VTX.classifier.parseExtList(ext.value); refreshSummary(); commit(); });
        ext.addEventListener('change', function () { ext.value = c.extensions.join(', '); });
        bodyEl.appendChild(ext);

        // --- filtro por nombre
        bodyEl.appendChild(el('div', 'block-title', 'Name filter (combined with the types above)'));
        var row = el('div', 'row');
        var mode = el('select', 'vtx-select');
        VTX.NAME_MODES.forEach(function (m) { var o = el('option', null, m.label); o.value = m.id; o.selected = c.nameRule.mode === m.id; mode.appendChild(o); });
        var val = el('input', 'text-input'); val.type = 'text'; val.value = c.nameRule.value; val.disabled = c.nameRule.mode === 'none';
        function syncName() {
            val.disabled = c.nameRule.mode === 'none';
            val.placeholder = c.nameRule.mode === 'regex' ? 'regular expression' : 'one or more, comma separated';
            val.classList.toggle('is-invalid', c.nameRule.mode === 'regex' && !!VTX.classifier.regexError(c.nameRule.value));
        }
        syncName();
        mode.addEventListener('change', function () { c.nameRule.mode = mode.value; syncName(); refreshSummary(); commit(); });
        val.addEventListener('input', function () { c.nameRule.value = val.value; syncName(); refreshSummary(); commit(); });
        row.appendChild(mode); row.appendChild(val); bodyEl.appendChild(row);

        // --- orden y borrado
        var act = el('div', 'rule-actions');
        var up = iconBtn('btn-icon-sm', ICON.up, 'Move up (higher priority)', function () { VTX.state.moveCategory(c.id, -1); renderRules(); });
        var dn = iconBtn('btn-icon-sm', ICON.down, 'Move down (lower priority)', function () { VTX.state.moveCategory(c.id, 1); renderRules(); });
        up.disabled = idx === 0; dn.disabled = idx === total - 1;
        var del = iconBtn('btn-icon-sm danger', ICON.trash, 'Delete category', function () {
            VTX.dialogs.confirm({ title: 'Delete category', message: 'Delete the category "' + (c.name || 'Untitled') + '"? Items already in the project are not touched.', okLabel: 'Delete', danger: true }, function (ok) {
                if (ok) { VTX.state.removeCategory(c.id); delete openCards[c.id]; renderRules(); }
            });
        });
        act.appendChild(up); act.appendChild(dn); act.appendChild(del); bodyEl.appendChild(act);

        card.appendChild(head); card.appendChild(summary); card.appendChild(bodyEl);
        return card;
    }

    // ------------------------------------------------------------ OPCIONES
    function buildOptions() {
        var box = el('div'), o = VTX.state.preset().options;

        box.appendChild(el('div', 'block-title', 'Which items to organize'));
        var sel = el('select', 'vtx-select');
        VTX.SCOPES.forEach(function (s) { var op = el('option', null, s.label); op.value = s.id; op.selected = o.scope === s.id; sel.appendChild(op); });
        sel.addEventListener('change', function () { o.scope = sel.value; commit(); });
        box.appendChild(sel);
        box.appendChild(el('div', 'hint', 'Loose items sit directly in the project root. Items you already placed in your own folders stay untouched. "All items" also re-sorts items inside folders (folders themselves are never moved).'));

        var fb = el('div', 'option-row');
        fb.appendChild(ui.makeSwitch(o.fallback.enabled, function (v) { o.fallback.enabled = v; commit(); }));
        fb.appendChild(el('span', 'option-label', 'Unmatched → folder'));
        var fbName = el('input', 'text-input'); fbName.type = 'text'; fbName.maxLength = 60; fbName.value = o.fallback.name;
        fbName.addEventListener('input', function () { o.fallback.name = fbName.value; commit(); });
        fb.appendChild(fbName); box.appendChild(fb);

        var pv = el('div', 'option-row');
        pv.appendChild(ui.makeSwitch(o.previewBeforeOrganize, function (v) { o.previewBeforeOrganize = v; commit(); }));
        pv.appendChild(el('span', 'option-label', 'Always preview before organizing'));
        box.appendChild(pv);
        return box;
    }

    // ------------------------------------------------------------ APARIENCIA
    function buildAppearance() {
        var box = el('div'), row = el('div', 'theme-toggle-row');
        var d = el('button', 'theme-option-btn', '🌙 Dark'); d.id = 'btnThemeDark';
        var l = el('button', 'theme-option-btn', '☀ Light'); l.id = 'btnThemeLight';
        d.addEventListener('click', function () { VTX.state.setTheme('dark'); ui.applyTheme('dark'); });
        l.addEventListener('click', function () { VTX.state.setTheme('light'); ui.applyTheme('light'); });
        row.appendChild(d); row.appendChild(l); box.appendChild(row);
        box.appendChild(el('div', 'hint', ''));
        return box;
    }

    VTX.uiSettings = { init: init, render: render, open: open, close: close };
})(window);
