// =========================================================
//  Vantyx Organizer - client/js/vtx-app.js
//  Arranque y flujos: escanear -> clasificar -> (vista previa)
//  -> ejecutar. La clasificación vive en el panel; el host de
//  After Effects solo lee el proyecto y mueve items.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var ui = VTX.ui, busy = false;

    function setBusy(b) { busy = b; VTX.uiMain.setBusy(b); }
    function finish() { setBusy(false); }

    function humanError(err) {
        if (!err) return 'Unknown error.';
        switch (err.code) {
            case 'NO_CEP': return 'This panel must run inside After Effects.';
            case 'HOST_NOT_LOADED':
            case 'MODULES_FAILED':
            case 'NO_EXT_PATH': return 'The After Effects host script is not loaded. Restart After Effects or reopen the panel.' + (err.message ? ' (' + err.message + ')' : '');
            default: return (err.message || err.code || 'Error') + (err.line ? ' (line ' + err.line + ')' : '');
        }
    }

    function fail(err) {
        finish();
        var msg = humanError(err);
        VTX.uiMain.showResult({ kind: 'error', message: msg });
        ui.status('Error: ' + msg.substring(0, 90));
    }

    function execute(plan) {
        setBusy(true);
        ui.status('Organizing ' + plan.moves.length + ' item(s)…');
        var payload = JSON.stringify({ moves: plan.moves.map(function (m) { return { id: m.id, folder: m.to }; }) });
        VTX.host.call('VTXO_applyPlan', [payload], function (err, res) {
            if (err) return fail(err);
            finish();
            VTX.uiMain.showResult({ kind: 'done', res: res, plan: plan });
            ui.status('Done · ' + res.moved + ' item(s) organized.');
        });
    }

    // mode: 'organize' (un clic) | 'preview' (solo resumen, con botón para aplicar)
    function run(mode) {
        if (busy) return;
        setBusy(true);
        VTX.host.ensureLoaded(function (e) {
            if (e) return fail(e);
            ui.status('Scanning project…');
            VTX.host.call('VTXO_scanProject', [], function (err, inv) {
                if (err) return fail(err);
                if (!inv.items.length) {
                    finish();
                    VTX.uiMain.showResult({ kind: 'nothing', stats: { total: 0, inScope: 0, moves: 0, alreadyOk: 0, unmatched: 0, outOfScope: 0 } });
                    ui.status('The project is empty.');
                    return;
                }
                var preset = VTX.state.preset();
                var plan = VTX.classifier.buildPlan(inv, preset);
                var showPreview = (mode === 'preview') || preset.options.previewBeforeOrganize;

                if (plan.moves.length === 0) {
                    finish();
                    VTX.uiMain.showResult({ kind: 'nothing', stats: plan.stats });
                    ui.status('Nothing to organize.');
                    if (mode === 'preview') VTX.uiMain.showPlanDialog(plan, null);
                    return;
                }
                if (showPreview) {
                    finish();
                    ui.status(plan.moves.length + ' item(s) ready to organize.');
                    VTX.uiMain.showPlanDialog(plan, function () { execute(plan); });
                    return;
                }
                execute(plan);
            });
        });
    }

    function init() {
        VTX.storage.load(function (raw) {
            VTX.state.init(raw);
            VTX.state.onChange(function (cfg) { VTX.storage.save(cfg); });
            if (!raw) VTX.state.commit();                 // primera vez: crea el fichero de configuración
            VTX.uiMain.init();
            VTX.uiSettings.init();
            ui.applyTheme(VTX.state.get().ui.theme);
            ui.status('Ready');
        });
    }

    VTX.app = { run: run, init: init };
    document.addEventListener('DOMContentLoaded', init);
})(window);
