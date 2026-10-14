// =========================================================
//  Vantyx Organizer - client/js/vtx-ui-main.js
//  Vista principal: preset activo, carpetas activas, botones
//  de organizar / vista previa y último resultado.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var ui = VTX.ui, el = ui.el;
    var PREVIEW_ITEMS_PER_GROUP = 60;

    function init() {
        ui.bindCollapsible(document.querySelector('.collapsible-toggle[data-panel="organizer"]'), ui.$('organizerPanelContent'), 'm_organizer');
        ui.bindCollapsible(document.querySelector('.collapsible-toggle[data-panel="result"]'), ui.$('resultPanelContent'), 'm_result');

        ui.$('presetSelect').addEventListener('change', function (e) {
            VTX.state.setActive(e.target.value);
            VTX.uiSettings.render();
            render();
        });
        ui.$('btnOrganize').addEventListener('click', function () { VTX.app.run('organize'); });
        ui.$('btnPreview').addEventListener('click', function () { VTX.app.run('preview'); });
        ui.$('btnSettings').addEventListener('click', function () { VTX.uiSettings.open(); });
        render();
    }

    function render() {
        var cfg = VTX.state.get(), preset = VTX.state.preset();

        var sel = ui.$('presetSelect');
        ui.clear(sel);
        cfg.presets.forEach(function (p) {
            var o = el('option', null, p.name); o.value = p.id; o.selected = (p.id === preset.id);
            sel.appendChild(o);
        });

        var box = ui.$('activeRules'); ui.clear(box);
        var n = 0;
        preset.categories.forEach(function (c) {
            var path = VTX.classifier.normalizePath(c.name);
            if (!c.enabled || !path) return;
            box.appendChild(el('span', 'chip', path)); n++;
        });
        var fb = preset.options.fallback;
        if (fb.enabled && VTX.classifier.normalizePath(fb.name)) {
            var chip = el('span', 'chip chip-soft', 'Unmatched → ' + VTX.classifier.normalizePath(fb.name));
            box.appendChild(chip);
        }
        if (!box.firstChild) box.appendChild(el('div', 'chips-empty', 'No active folders. Open ⚙ Settings to enable or create categories.'));
        ui.$('activeRulesTitle').textContent = 'Active folders (' + n + ')';
    }

    function setBusy(b) {
        ['btnOrganize', 'btnPreview', 'btnSettings', 'presetSelect'].forEach(function (id) { ui.$(id).disabled = b; });
    }

    function line(parent, cls, parts) {
        var d = el('div', cls);
        parts.forEach(function (p) {
            if (typeof p === 'string') d.appendChild(document.createTextNode(p));
            else d.appendChild(el('b', null, String(p.b)));
        });
        parent.appendChild(d);
        return d;
    }

    function statsLine(parent, s, moves) {
        var parts = [{ b: moves }, ' item(s) to move'];
        parts.push(' · ', { b: s.alreadyOk }, ' already in place');
        parts.push(' · ', { b: s.unmatched }, ' without a matching rule');
        if (s.outOfScope) parts.push(' · ', { b: s.outOfScope }, ' left inside your folders');
        line(parent, 'stat-line', parts);
    }

    function showResult(r) {
        var body = ui.$('resultBody'); ui.clear(body);
        if (r.kind === 'error') {
            body.appendChild(el('div', 'result-big result-err', 'Something went wrong'));
            body.appendChild(el('div', 'result-muted', r.message));
        } else if (r.kind === 'nothing') {
            body.appendChild(el('div', 'result-big', 'Nothing to organize'));
            statsLine(body, r.stats, 0);
        } else {
            var res = r.res;
            body.appendChild(el('div', 'result-big', res.moved + ' item(s) organized'));
            if (res.created.length) body.appendChild(el('div', 'result-muted', 'Folders created: ' + res.created.join(', ')));
            else body.appendChild(el('div', 'result-muted', 'No new folders were needed.'));
            var extra = [];
            if (res.alreadyThere) extra.push(res.alreadyThere + ' already in place');
            if (res.missing) extra.push(res.missing + ' no longer in the project');
            if (res.skipped) extra.push(res.skipped + ' skipped');
            if (extra.length) body.appendChild(el('div', 'result-muted', extra.join(' · ')));
            (res.errors || []).slice(0, 3).forEach(function (e) { body.appendChild(el('div', 'result-err', '#' + e.id + ': ' + e.message)); });
            body.appendChild(el('div', 'result-muted', 'Undo (Ctrl/Cmd+Z) reverts the whole run in one step.'));
        }
        // abre el panel de resultado si estaba plegado
        var h = document.querySelector('.collapsible-toggle[data-panel="result"]');
        if (h && h.classList.contains('is-collapsed')) h.click();
    }

    // Resumen de cambios antes de ejecutar. onApply puede ser null (solo informativo).
    function showPlanDialog(plan, onApply) {
        var buttons = [{ label: 'Close' }];
        if (onApply && plan.moves.length) buttons.push({ label: 'Organize now', primary: true, onClick: function () { onApply(); } });
        VTX.dialogs.show({
            title: plan.moves.length ? 'Preview · ' + plan.moves.length + ' item(s)' : 'Preview · nothing to move',
            wide: true,
            buttons: buttons,
            build: function (body) {
                statsLine(body, plan.stats, plan.moves.length);
                plan.groups.forEach(function (g) {
                    var card = el('div', 'group-card');
                    var head = el('div', 'group-head');
                    head.appendChild(el('span', 'group-path', '📁 ' + g.path));
                    head.appendChild(el('span', 'group-count', String(g.items.length)));
                    head.appendChild(el('span', 'group-chevron', '▼'));
                    var list = el('div', 'group-items'); list.hidden = true;
                    g.items.slice(0, PREVIEW_ITEMS_PER_GROUP).forEach(function (m) {
                        var row = el('div', 'group-item');
                        row.appendChild(el('span', null, m.name));
                        row.appendChild(el('span', 'from', '← ' + m.from));
                        list.appendChild(row);
                    });
                    if (g.items.length > PREVIEW_ITEMS_PER_GROUP) list.appendChild(el('div', 'group-more', '+ ' + (g.items.length - PREVIEW_ITEMS_PER_GROUP) + ' more'));
                    head.addEventListener('click', function () { list.hidden = !list.hidden; card.classList.toggle('is-open', !list.hidden); });
                    card.appendChild(head); card.appendChild(list); body.appendChild(card);
                });
                if (!plan.moves.length) body.appendChild(el('div', 'hint', 'Everything that matches an active rule is already in its folder, or no rule matches the remaining items.'));
            }
        });
    }

    VTX.uiMain = { init: init, render: render, setBusy: setBusy, showResult: showResult, showPlanDialog: showPlanDialog };
})(window);
