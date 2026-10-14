(function () {
    'use strict';
    var VTX = window.VTX, t = VTX.t, el = VTX.el, logic = VTX.logic;
    var state = { tools: [], problems: [], warning: null, env: null, busy: {}, update: null, settings: null };

    function byId(id) { return document.getElementById(id); }
    function fail(err) { VTX.toast(VTX.errorText(err), 'error'); }

    // ---------------------------------------------------------- rendering
    function renderEnv() {
        var box = byId('env'); box.textContent = '';
        var e = state.env; if (!e) return;

        var g1 = el('div', 'env-group'); g1.appendChild(el('span', 'env-label', t('env.ae')));
        if (e.afterEffects.length) e.afterEffects.forEach(function (a) { g1.appendChild(el('span', 'chip', a.label)); });
        else g1.appendChild(el('span', 'chip muted', t('env.ae.none')));
        box.appendChild(g1);

        var g2 = el('div', 'env-group'); g2.appendChild(el('span', 'env-label', t('env.debug')));
        var d = e.cepDebug;
        var text = !d.supported ? t('env.debug.na') : (d.enabled.length ? t('env.debug.on', { v: d.enabled.join(', ') }) : t('env.debug.off'));
        g2.appendChild(el('span', 'chip' + (d.enabled.length ? '' : ' muted'), text));
        box.appendChild(g2);
    }

    function renderWarnings() {
        var box = byId('warnings'); box.textContent = '';
        if (state.warning) box.appendChild(el('div', 'notice', state.warning));
        state.problems.forEach(function (p) { box.appendChild(el('div', 'notice', p.source + ' \u2014 ' + p.message)); });
    }

    function card(tool) {
        var target = tool.targets[0];
        var c = el('article', 'tool-card' + (state.busy[tool.id] ? ' busy' : ''));
        var head = el('div', 'tool-head');
        head.appendChild(el('span', 'tool-name', tool.name));
        if (tool.version) head.appendChild(el('span', 'tool-version', 'v' + tool.version));
        head.appendChild(el('span', 'badge', tool.kindLabel));
        c.appendChild(head);
        if (tool.description) c.appendChild(el('div', 'tool-desc', tool.description));
        else if (!tool.inLibrary) c.appendChild(el('div', 'tool-desc', t('tool.orphan')));

        var st = el('div', 'tool-status s-' + target.state);
        st.appendChild(el('span', 'dot'));
        st.appendChild(el('span', null, t('state.' + target.state)));
        if (target.installedVersion && target.state !== 'installed') st.appendChild(el('span', 'tool-version', t('tool.installed', { v: target.installedVersion })));
        c.appendChild(st);

        if (target.missing && target.missing.length) c.appendChild(el('div', 'tool-detail', t('tool.missing', { n: target.missing.length, list: logic.shortList(target.missing) })));
        if (target.modified && target.modified.length) c.appendChild(el('div', 'tool-detail', t('tool.modified', { n: target.modified.length, list: logic.shortList(target.modified) })));
        if (target.error) c.appendChild(el('div', 'tool-detail', VTX.errorText(target.error)));
        if (target.installPath && target.state !== 'not-installed') c.appendChild(el('div', 'tool-path', target.installPath));

        var row = el('div', 'tool-actions');
        logic.actionsFor(tool, target).forEach(function (a) {
            var primary = a === 'install' || a === 'update' || a === 'repair';
            var b = el('button', 'pill-btn' + (primary ? ' primary' : '') + (a === 'uninstall' ? ' danger' : ''), t('btn.' + a));
            b.addEventListener('click', function () { act(tool, target, a); });
            row.appendChild(b);
        });
        c.appendChild(row);
        return c;
    }

    function renderTools() {
        var box = byId('tools'); box.textContent = '';
        if (!state.tools.length) { box.appendChild(el('div', 'empty', t('lib.empty'))); return; }
        state.tools.forEach(function (tool) { box.appendChild(card(tool)); });
    }

    function render() { renderEnv(); renderWarnings(); renderTools(); }

    // ------------------------------------------------------------ actions
    async function refresh() {
        var res = await Promise.all([window.hub.list(), window.hub.env()]);
        if (!res[0].ok) return fail(res[0].error);
        state.tools = res[0].data.tools; state.problems = res[0].data.problems; state.warning = res[0].data.warning;
        if (res[1].ok) state.env = res[1].data;
        render();
    }

    async function withBusy(tool, fn) {
        state.busy[tool.id] = true; renderTools();
        try { await fn(); }
        finally { delete state.busy[tool.id]; await refresh(); }
    }

    async function doInstall(tool, mode) {
        await withBusy(tool, async function () {
            var res = await window.hub.install(tool.id, mode === 'repair' ? { repair: true } : {});
            if (!res.ok && res.error.code === 'UNMANAGED_EXISTS') {
                var body = el('div');
                body.appendChild(el('p', null, t('modal.replace.body')));
                body.appendChild(el('p')).appendChild(el('code', null, (res.error.details && res.error.details.path) || ''));
                body.appendChild(el('p', null, t('modal.replace.note')));
                var yes = await VTX.modal({ title: t('modal.replace.title'), body: body, actions: [
                    { label: t('btn.cancel'), value: false }, { label: t('btn.replace'), value: true, cls: 'primary' }] });
                if (!yes) return;
                res = await window.hub.install(tool.id, { replaceUnmanaged: true });
            }
            if (!res.ok) return fail(res.error);
            var r = res.data, v = { name: tool.name, v: r.version };
            VTX.toast(t('toast.' + (r.action === 'already-installed' ? 'already' : r.action), v));
            if (r.backupPath) VTX.toast(t('toast.backup', { path: r.backupPath }), 'warn');
            if (r.debugMode === 'partial') VTX.toast(t('toast.debugPartial'), 'warn');
        });
    }

    async function doUninstall(tool) {
        var pv = await window.hub.previewUninstall(tool.id);
        if (!pv.ok) return fail(pv.error);
        var body = el('div'), cb = null;
        body.appendChild(el('p', null, t('modal.uninstall.body')));
        if (pv.data.userData.length) {
            body.appendChild(el('p', null, t('modal.uninstall.data')));
            pv.data.userData.forEach(function (p) { body.appendChild(el('p')).appendChild(el('code', null, p)); });
            var row = el('label', 'check-row');
            cb = el('input'); cb.type = 'checkbox';
            row.appendChild(cb); row.appendChild(el('span', null, t('modal.uninstall.check')));
            body.appendChild(row);
        }
        var ok = await VTX.modal({ title: t('modal.uninstall.title', { name: tool.name }), body: body, actions: [
            { label: t('btn.cancel'), value: false }, { label: t('btn.uninstall'), value: true, cls: 'danger' }] });
        if (!ok) return;
        var removeData = !!(cb && cb.checked);

        await withBusy(tool, async function () {
            var res = await window.hub.uninstall(tool.id, removeData ? { removeUserData: true } : {});
            if (!res.ok) return fail(res.error);
            var r = res.data;
            if (r.partial) return VTX.toast(t('toast.partial', { n: r.errors.length }), 'error');
            VTX.toast(t('toast.uninstalled', { name: tool.name }));
            if (r.leftover.length) VTX.toast(t('toast.left', { list: logic.shortList(r.leftover, 5) }), 'warn');
            if (r.userDataRemoved.length) VTX.toast(t('toast.dataRemoved'));
            else if (r.userDataKept.length) VTX.toast(t('toast.dataKept'));
            r.warnings.forEach(function (w) { VTX.toast(w, 'warn'); });
        });
    }

    async function act(tool, target, action) {
        if (action === 'install' || action === 'update' || action === 'repair') return doInstall(tool, logic.installMode(target));
        if (action === 'uninstall') return doUninstall(tool);
        if (action === 'open') { var r = await window.hub.open(tool.id, 'install'); if (!r.ok) fail(r.error); }
    }


    // ------------------------------------------------------------ updates
    function fmtTime(ts) {
        try { return new Date(ts).toLocaleString(VTX.lang === 'es' ? 'es-ES' : 'en-GB'); } catch (e) { return ''; }
    }

    function renderUpdates() {
        var box = byId('updates'); if (!box) return;
        var st = state.update;
        if (!st || !window.updates) { box.hidden = true; return; }
        box.hidden = false; box.textContent = '';
        var view = logic.updateView(st);
        var info = st.info;

        var head = el('div', 'update-head');
        head.appendChild(el('span', 'update-title', t('upd.title')));
        head.appendChild(el('span', 'tool-version', t('upd.version') + ': v' + st.currentVersion));
        box.appendChild(head);

        var vars = { v: info ? info.version : '', p: st.progress ? Math.floor(st.progress.percent) : 0 };
        var line = el('div', 'tool-status update-status s-' + view.kind);
        line.appendChild(el('span', 'dot'));
        line.appendChild(el('span', null, t(view.key, vars)));
        box.appendChild(line);

        if (st.status === 'error' && st.error) box.appendChild(el('div', 'tool-detail', VTX.errorText(st.error)));
        if (st.lastChecked && st.status !== 'disabled') box.appendChild(el('div', 'update-meta', t('upd.checked', { t: fmtTime(st.lastChecked) })));

        if (view.notes && info) {
            var notes = el('div', 'update-notes');
            notes.appendChild(el('div', 'update-notes-title', t('upd.newversion', { v: info.version }) + ' · ' + t('upd.notes')));
            notes.appendChild(el('div', 'update-notes-body', info.notes || t('upd.notes.none')));
            box.appendChild(notes);
        }

        if (view.progress) {
            var bar = el('div', 'progress'), fill = el('div');
            if (fill.style) fill.style.width = (st.progress ? st.progress.percent : 0) + '%';
            bar.appendChild(fill); box.appendChild(bar);
        }

        var row = el('div', 'update-actions');
        view.buttons.forEach(function (a) {
            var b = el('button', 'pill-btn' + (a === 'check' ? '' : ' primary'), t('btn.' + a));
            if (a === 'check' && st.status === 'checking') b.disabled = true;
            b.addEventListener('click', function () { updAction(a); });
            row.appendChild(b);
        });
        if (st.status !== 'disabled' && state.settings) {
            var lab = el('label', 'check-row'), cb = el('input');
            cb.type = 'checkbox'; cb.checked = !!state.settings.autoCheckUpdates;
            cb.addEventListener('change', function () { setAutoCheck(cb); });
            lab.appendChild(cb); lab.appendChild(el('span', null, t('upd.auto')));
            row.appendChild(lab);
        }
        box.appendChild(row);
    }

    // Replies to check/download can arrive after newer pushed states; never go back in time.
    function acceptUpdate(st) {
        if (!st) return false;
        if (state.update && typeof st.seq === 'number' && typeof state.update.seq === 'number' && st.seq < state.update.seq) return false;
        state.update = st;
        return true;
    }

    async function setAutoCheck(cb) {
        var want = !!cb.checked;
        var r = await window.settings.set({ autoCheckUpdates: want });
        if (!r.ok) { cb.checked = !want; return fail(r.error); }
        state.settings = r.data;
    }

    function reportUpdate(st) {
        if (!st) return;
        if (st.status === 'not-available') VTX.toast(t('toast.upd.uptodate'));
        else if (st.status === 'available') VTX.toast(t('toast.upd.available', { v: st.info.version }));
        else if (st.status === 'downloaded') VTX.toast(t('toast.upd.downloaded', { v: st.info ? st.info.version : '' }));
        else if (st.status === 'error') VTX.toast(VTX.errorText(st.error), 'error');
    }

    async function updAction(a) {
        if (!window.updates) return;
        if (a === 'check' || a === 'download') {
            var r = await (a === 'check' ? window.updates.check() : window.updates.download());
            if (!r.ok) return fail(r.error);
            if (acceptUpdate(r.data)) renderUpdates();
            reportUpdate(r.data);
            return;
        }
        if (a === 'restart') {
            if (Object.keys(state.busy).length) return VTX.toast(t('toast.upd.busy'), 'warn');
            var body = el('div');
            body.appendChild(el('p', null, t('modal.restart.body', { v: state.update && state.update.info ? state.update.info.version : '' })));
            body.appendChild(el('p', null, t('modal.restart.note')));
            var yes = await VTX.modal({ title: t('modal.restart.title'), body: body, actions: [
                { label: t('btn.cancel'), value: false }, { label: t('btn.restart'), value: true, cls: 'primary' }] });
            if (!yes) return;
            var res = await window.updates.installAndRestart();
            if (!res.ok) fail(res.error);
        }
    }

    async function initUpdates() {
        if (!window.updates) return;
        if (window.settings) { var s = await window.settings.get(); if (s.ok) state.settings = s.data; }
        var u = await window.updates.getState();
        if (u.ok) acceptUpdate(u.data);
        window.updates.onState(function (st) { if (acceptUpdate(st)) renderUpdates(); });
        renderUpdates();
    }

    // --------------------------------------------------------------- boot
    byId('subtitle').textContent = t('app.subtitle');
    byId('libTitle').textContent = t('lib.title');
    byId('btnRefresh').addEventListener('click', function () { refresh(); });
    refresh();
    initUpdates();
})();
