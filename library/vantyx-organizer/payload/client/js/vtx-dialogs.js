// =========================================================
//  Vantyx Organizer - client/js/vtx-dialogs.js
//  Diálogos propios con el estilo de Vantyx. prompt() del
//  navegador no está soportado de forma fiable dentro de los
//  paneles CEP, así que no se usa en ningún sitio.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var el = function (t, c, x) { return VTX.ui.el(t, c, x); };

    // opts: { title, wide, build(bodyEl), buttons:[{label, primary, danger, onClick, keepOpen}], onCancel }
    function show(opts) {
        var overlay = el('div', 'settings-overlay is-open');
        var modal = el('div', 'settings-modal vtx-dialog' + (opts.wide ? ' wide' : ''));
        var head = el('div', 'settings-modal-header');
        head.appendChild(el('span', null, opts.title || ''));
        var x = el('button', 'btn-icon-sm', '✕'); x.title = 'Close'; head.appendChild(x);
        var body = el('div', 'dialog-body');
        var foot = el('div', 'dialog-footer');
        modal.appendChild(head); modal.appendChild(body); modal.appendChild(foot);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        var closed = false;
        function close() {
            if (closed) return; closed = true;
            document.removeEventListener('keydown', onKey, true);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
        function cancel() { if (closed) return; close(); if (opts.onCancel) opts.onCancel(); }
        function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }
        document.addEventListener('keydown', onKey, true);
        x.addEventListener('click', cancel);
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) cancel(); });

        (opts.buttons || []).forEach(function (b) {
            var btn = el('button', 'pill-btn' + (b.primary ? ' pill-primary' : '') + (b.danger ? ' pill-danger' : ''), b.label);
            btn.addEventListener('click', function () {
                if (b.onClick && b.onClick(btn) === false) return;
                if (!b.keepOpen) close();
            });
            foot.appendChild(btn);
        });
        if (opts.build) opts.build(body, close);
        return { close: close, body: body };
    }

    // cb(texto | null)
    function prompt(opts, cb) {
        var input, dlg, settled = false;
        function finish(v) { if (settled) return; settled = true; cb(v); }
        function submit() {
            var v = input.value.replace(/^\s+|\s+$/g, '');
            if (!v) { input.classList.add('is-invalid'); input.focus(); return false; }
            finish(v);
        }
        dlg = show({
            title: opts.title,
            onCancel: function () { finish(null); },
            build: function (body) {
                if (opts.label) body.appendChild(el('div', 'block-title', opts.label));
                input = el('input', 'text-input'); input.type = 'text'; input.value = opts.value || ''; input.maxLength = 60;
                input.addEventListener('keydown', function (e) {
                    input.classList.remove('is-invalid');
                    if (e.key === 'Enter' && submit() !== false) dlg.close();
                });
                body.appendChild(input);
                setTimeout(function () { input.focus(); input.select(); }, 30);
            },
            buttons: [
                { label: 'Cancel', onClick: function () { finish(null); } },
                { label: opts.okLabel || 'OK', primary: true, onClick: submit }
            ]
        });
    }

    // cb(true | false)
    function confirm(opts, cb) {
        var settled = false;
        function finish(v) { if (settled) return; settled = true; cb(v); }
        show({
            title: opts.title,
            onCancel: function () { finish(false); },
            build: function (body) { body.appendChild(el('div', 'dialog-msg', opts.message)); },
            buttons: [
                { label: 'Cancel', onClick: function () { finish(false); } },
                { label: opts.okLabel || 'OK', primary: !opts.danger, danger: !!opts.danger, onClick: function () { finish(true); } }
            ]
        });
    }

    VTX.dialogs = { show: show, prompt: prompt, confirm: confirm };
})(window);
