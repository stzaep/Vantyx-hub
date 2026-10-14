// =========================================================
//  Vantyx Organizer - client/js/vtx-ui-common.js
//  Utilidades de DOM compartidas. Nunca se usa innerHTML con
//  datos del usuario (nombres de carpeta, de items...): solo
//  textContent, para que ningún nombre pueda inyectar HTML.
// =========================================================
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};
    var statusEl = null;

    VTX.ui = {
        $: function (id) { return document.getElementById(id); },
        el: function (tag, cls, text) {
            var e = document.createElement(tag);
            if (cls) e.className = cls;
            if (text !== undefined && text !== null) e.textContent = text;
            return e;
        },
        clear: function (node) { while (node.firstChild) node.removeChild(node.firstChild); },
        status: function (msg) {
            if (!statusEl) statusEl = document.getElementById('statusBar');
            if (statusEl) statusEl.textContent = msg;
        },
        // Solo para constantes SVG definidas en el código (nunca datos del usuario).
        icon: function (svg) { var s = document.createElement('span'); s.innerHTML = svg; return s.firstChild; },
        applyTheme: function (name) {
            document.documentElement.classList.toggle('theme-light', name === 'light');
            var d = document.getElementById('btnThemeDark'), l = document.getElementById('btnThemeLight');
            if (d) d.classList.toggle('active', name !== 'light');
            if (l) l.classList.toggle('active', name === 'light');
        },
        showView: function (name) {
            document.getElementById('viewMain').classList.toggle('is-hidden', name !== 'main');
            document.getElementById('viewSettings').classList.toggle('is-hidden', name !== 'settings');
            window.scrollTo(0, 0);
        },
        // Interruptor tipo Vantyx. Devuelve <label.switch>.
        makeSwitch: function (checked, onChange) {
            var label = document.createElement('label'); label.className = 'switch';
            var input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!checked;
            var slider = document.createElement('span'); slider.className = 'slider';
            input.addEventListener('change', function () { onChange(input.checked); });
            label.appendChild(input); label.appendChild(slider);
            return label;
        },
        // Cabeceras plegables ya presentes en el HTML (.collapsible-toggle + #<id>PanelContent)
        // o creadas por JS. El estado plegado se guarda en la configuración.
        bindCollapsible: function (headerEl, contentEl, key) {
            function set(collapsed) {
                headerEl.classList.toggle('is-collapsed', collapsed);
                contentEl.hidden = collapsed;
            }
            set(!!VTX.state.get().ui.collapsed[key]);
            headerEl.addEventListener('click', function () {
                var now = !headerEl.classList.contains('is-collapsed');
                set(now);
                VTX.state.setCollapsed(key, now);
            });
            return set;
        }
    };
})(window);
