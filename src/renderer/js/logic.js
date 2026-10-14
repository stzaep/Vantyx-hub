// Pure UI decisions (no DOM) so they can be unit-tested.
(function (root) {
    'use strict';
    var VTX = root.VTX = root.VTX || {};

    var MANAGED = { installed: 1, outdated: 1, incomplete: 1, modified: 1 };

    // Which buttons a tool card shows for a given install state.
    function actionsFor(tool, target) {
        var s = target.state, a = [];
        if (s === 'not-installed') a = tool.inLibrary ? ['install'] : [];
        else if (s === 'unmanaged') a = ['install'];
        else if (s === 'outdated') a = ['update', 'uninstall'];
        else if (s === 'incomplete' || s === 'modified') a = ['repair', 'uninstall'];
        else if (s === 'installed') a = ['uninstall'];
        else if (s === 'error') a = [];
        if (MANAGED[s]) a.push('open');
        return a;
    }

    function installMode(target) {
        return (target.state === 'incomplete' || target.state === 'modified') ? 'repair' : 'install';
    }

    function shortList(list, max) {
        max = max || 3;
        var s = list.slice(0, max).join(', ');
        return list.length > max ? s + ', \u2026' : s;
    }

    // What the Updates card shows for a given update state (pure, testable).
    // -> { kind: ok|warn|error|info|muted, key, buttons: [check|download|restart], progress: bool, notes: bool }
    function updateView(st) {
        var v = { kind: 'muted', key: 'upd.status.' + st.status, buttons: [], progress: false, notes: false };
        switch (st.status) {
            case 'disabled': v.key = 'upd.disabled.' + (st.disabledReason || 'not-configured'); break;
            case 'idle': v.buttons = ['check']; break;
            case 'checking': v.kind = 'info'; v.buttons = ['check']; break;
            case 'not-available': v.kind = 'ok'; v.buttons = ['check']; break;
            case 'available': v.kind = 'warn'; v.buttons = ['download']; v.notes = true; break;
            case 'downloading': v.kind = 'info'; v.progress = true; v.notes = true; break;
            case 'downloaded': v.kind = 'ok'; v.buttons = ['restart']; v.notes = true; break;
            case 'error':
                v.kind = 'error'; v.buttons = st.info ? ['download', 'check'] : ['check']; v.notes = !!st.info; break;
        }
        return v;
    }

    VTX.logic = { actionsFor: actionsFor, installMode: installMode, shortList: shortList, updateView: updateView };
    if (typeof module !== 'undefined' && module.exports) module.exports = VTX.logic;
})(typeof window !== 'undefined' ? window : globalThis);
