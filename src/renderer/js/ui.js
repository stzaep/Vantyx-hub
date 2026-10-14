// Small DOM helpers. Text is always set with textContent (never innerHTML).
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};

    VTX.el = function (tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };

    VTX.toast = function (message, kind, ms) {
        var box = document.getElementById('toasts');
        var n = VTX.el('div', 'toast' + (kind ? ' ' + kind : ''), message);
        box.appendChild(n);
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, ms || (kind === 'error' ? 9000 : 5500));
    };

    // opts: { title, body: Node, actions: [{ label, value, cls }] } -> Promise<value|null>
    VTX.modal = function (opts) {
        return new Promise(function (resolve) {
            var rootEl = document.getElementById('modal-root');
            var back = VTX.el('div', 'modal-backdrop');
            var box = VTX.el('div', 'modal');
            box.setAttribute('role', 'dialog');
            box.appendChild(VTX.el('h2', null, opts.title));
            var body = VTX.el('div', 'modal-body');
            body.appendChild(opts.body);
            box.appendChild(body);
            var row = VTX.el('div', 'modal-actions');
            var done = false;
            function close(v) {
                if (done) return; done = true;
                document.removeEventListener('keydown', onKey);
                if (back.parentNode) back.parentNode.removeChild(back);
                resolve(v);
            }
            function onKey(e) { if (e.key === 'Escape') close(null); }
            opts.actions.forEach(function (a) {
                var b = VTX.el('button', 'pill-btn ' + (a.cls || ''), a.label);
                b.addEventListener('click', function () { close(a.value); });
                row.appendChild(b);
            });
            box.appendChild(row);
            back.appendChild(box);
            document.addEventListener('keydown', onKey);
            rootEl.appendChild(back);
            var first = row.querySelector('button:last-child'); if (first) first.focus();
        });
    };
})(window);
