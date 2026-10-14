(function () {
    'use strict';

    var csInterface = typeof VantyxCSInterface !== 'undefined' ? new VantyxCSInterface() : null;

    // ---------------------------------------------------------------
    // Presets integrados, en notación cubic-bezier(x1,y1,x2,y2) estándar
    // (los mismos valores que usa CSS para ease/ease-in/ease-out/etc.).
    // Viven como un grupo más ("Built-in") dentro de la misma biblioteca,
    // pero son de solo lectura: no se pueden renombrar, borrar ni el
    // grupo en sí se puede eliminar.
    // ---------------------------------------------------------------
    var BUILT_IN_PRESETS = [
        { id: 'linear', name: 'Linear', x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: 'ease', name: 'Ease', x1: 0.25, y1: 0.10, x2: 0.25, y2: 1.00 },
        { id: 'ease-in', name: 'Ease In', x1: 0.42, y1: 0, x2: 1.00, y2: 1.00 },
        { id: 'ease-out', name: 'Ease Out', x1: 0.00, y1: 0, x2: 0.58, y2: 1.00 },
        { id: 'ease-in-out', name: 'Ease In Out', x1: 0.42, y1: 0, x2: 0.58, y2: 1.00 },
        { id: 'strong-in', name: 'Strong In', x1: 0.60, y1: 0, x2: 1.00, y2: 1.00 },
        { id: 'strong-out', name: 'Strong Out', x1: 0.00, y1: 0, x2: 0.40, y2: 1.00 }
    ];

    var BUILTIN_GROUP_ID = 'builtin';

    // Rango máximo de overshoot permitido para los handles (igual que el
    // comportamiento de referencia de Flow: el tiempo (x) siempre se queda
    // entre 0 y 1, pero el valor (y) puede salirse bastante de la caja).
    var CURVE_Y_MIN = -0.6;
    var CURVE_Y_MAX = 1.75;

    // Límites del tamaño (en px, ancho = alto) al que se puede arrastrar
    // manualmente el editor de curva grande. Solo afecta el área de
    // dibujo; no tiene relación con los valores/handles de la curva.
    var CURVE_EDITOR_MIN_SIZE = 160;
    var CURVE_EDITOR_MAX_SIZE = 640;

    var LIBRARY_FORMAT_ID = 'vantyx-flow-library';
    var LIBRARY_FORMAT_VERSION = 1;

    function makeId(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
    }

    function builtinGroup() {
        return {
            id: BUILTIN_GROUP_ID,
            name: 'Built-in',
            builtin: true,
            curves: BUILT_IN_PRESETS.map(function (p) {
                return { id: p.id, name: p.name, x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };
            })
        };
    }

    var defaultState = {
        library: { formatId: LIBRARY_FORMAT_ID, formatVersion: LIBRARY_FORMAT_VERSION, groups: [] },
        activeGroupId: null,
        presetCardSize: 84,
        curveEditorSize: 0, // 0 = todavía no fijado a mano; se calcula en init()
        bounceParams: { bounces: 4, decay: 0.5 },
        // Última curva que quedó cargada en el editor grande (los 4 valores
        // x1,y1,x2,y2). Se guarda en cada cambio "asentado" (soltar un
        // handle, escribir los valores a mano, cargar un preset, leer de
        // AE) para que al volver a abrir After Effects el editor arranque
        // exactamente con la misma forma de curva de la sesión anterior,
        // en vez de resetear siempre a "Ease".
        currentCurve: { x1: 0.25, y1: 0.10, x2: 0.25, y2: 1.00 }
    };

    var state = defaultState;
    try {
        var saved = localStorage.getItem('vantyx_flow_state');
        if (saved) state = JSON.parse(saved);
    } catch (e) {}

    // ---- Migración / saneado del estado guardado ----
    (function normalizeState() {
        if (!state.library || !Array.isArray(state.library.groups)) {
            state.library = { formatId: LIBRARY_FORMAT_ID, formatVersion: LIBRARY_FORMAT_VERSION, groups: [] };
        }

        // Migra el formato antiguo (customPresets planos) a un grupo normal.
        if (state.customPresets && state.customPresets.length) {
            state.library.groups.push({
                id: makeId('grp'),
                name: 'Migrated',
                curves: state.customPresets.map(function (p) {
                    return { id: makeId('crv'), name: p.name, x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 };
                })
            });
        }
        delete state.customPresets;

        // Quita cualquier grupo "builtin" persistido de una sesión anterior
        // y vuelve a anteponer uno fresco, para que los presets integrados
        // no queden desincronizados si esta herramienta se actualiza.
        state.library.groups = state.library.groups.filter(function (g) { return !g.builtin; });
        state.library.groups.unshift(builtinGroup());

        // Garantiza que exista al menos un grupo propio del usuario.
        var hasCustomGroup = state.library.groups.some(function (g) { return !g.builtin; });
        if (!hasCustomGroup) {
            state.library.groups.push({ id: makeId('grp'), name: 'My Curves', curves: [] });
        }

        if (!state.activeGroupId || !state.library.groups.some(function (g) { return g.id === state.activeGroupId; })) {
            state.activeGroupId = state.library.groups[0].id; // Built-in por defecto
        }
        if (!state.presetCardSize) state.presetCardSize = 84;

        // Sanea el tamaño guardado del editor de curva: si no es un número
        // válido dentro de rango, se deja en 0 para que init() lo calcule
        // de nuevo a partir del ancho real del panel (queda "cuadrado",
        // como el comportamiento de antes de tener este control).
        if (typeof state.curveEditorSize !== 'number' || !isFinite(state.curveEditorSize) ||
            (state.curveEditorSize !== 0 &&
                (state.curveEditorSize < CURVE_EDITOR_MIN_SIZE || state.curveEditorSize > CURVE_EDITOR_MAX_SIZE))) {
            state.curveEditorSize = 0;
        }

        // Sanea los parámetros de bounce guardados.
        if (!state.bounceParams || typeof state.bounceParams !== 'object') {
            state.bounceParams = { bounces: 4, decay: 0.5 };
        }
        if (typeof state.bounceParams.bounces !== 'number' || !isFinite(state.bounceParams.bounces)) {
            state.bounceParams.bounces = 4;
        }
        state.bounceParams.bounces = Math.min(8, Math.max(1, Math.round(state.bounceParams.bounces)));
        if (typeof state.bounceParams.decay !== 'number' || !isFinite(state.bounceParams.decay)) {
            state.bounceParams.decay = 0.5;
        }
        state.bounceParams.decay = Math.min(0.9, Math.max(0, state.bounceParams.decay));

        // Sanea la curva actual guardada del editor: si falta o viene
        // corrupta, vuelve al "Ease" de siempre.
        var cc = state.currentCurve;
        var ccValid = cc && typeof cc === 'object' &&
            [cc.x1, cc.y1, cc.x2, cc.y2].every(function (n) { return typeof n === 'number' && isFinite(n); });
        if (!ccValid) {
            state.currentCurve = { x1: 0.25, y1: 0.10, x2: 0.25, y2: 1.00 };
        } else {
            state.currentCurve = {
                x1: Math.min(1, Math.max(0, cc.x1)),
                y1: Math.min(CURVE_Y_MAX, Math.max(CURVE_Y_MIN, cc.y1)),
                x2: Math.min(1, Math.max(0, cc.x2)),
                y2: Math.min(CURVE_Y_MAX, Math.max(CURVE_Y_MIN, cc.y2))
            };
        }
    })();

    function saveStateToDisk() {
        try { localStorage.setItem('vantyx_flow_state', JSON.stringify(state)); } catch (e) {}
    }

    function getActiveGroup() {
        var found = null;
        state.library.groups.forEach(function (g) {
            if (g.id === state.activeGroupId) found = g;
        });
        return found || state.library.groups[0];
    }

    // ---- refs ----
    var svg = document.getElementById('curveEditorSvg');
    var curveEditorCanvasWrap = document.getElementById('curveEditorCanvasWrap');
    var curveResizeHandle = document.getElementById('curveResizeHandle');
    var curveContextMenu = document.getElementById('curveContextMenu');
    var btnReverseCurve = document.getElementById('btnReverseCurve');
    var curveBoundsRect = document.getElementById('curveBoundsRect');
    var handle1 = document.getElementById('handle1');
    var handle2 = document.getElementById('handle2');
    var handle1Guide = document.getElementById('handle1Guide');
    var handle2Guide = document.getElementById('handle2Guide');
    var curveEditorPath = document.getElementById('curveEditorPath');
    var curveValuesInput = document.getElementById('curveValuesInput');
    var btnApplyCurve = document.getElementById('btnApplyCurve');
    var btnReadCurve = document.getElementById('btnReadCurve');
    var btnPrevPreset = document.getElementById('btnPrevPreset');
    var btnNextPreset = document.getElementById('btnNextPreset');
    var btnFavCurve = document.getElementById('btnFavCurve');
    var curvesGrid = document.getElementById('curvesGrid');
    var groupSelect = document.getElementById('groupSelect');
    var btnAddGroup = document.getElementById('btnAddGroup');
    var btnRenameGroup = document.getElementById('btnRenameGroup');
    var btnDeleteGroup = document.getElementById('btnDeleteGroup');
    var btnImportLibrary = document.getElementById('btnImportLibrary');
    var btnExportLibrary = document.getElementById('btnExportLibrary');
    var presetSizeSlider = document.getElementById('presetSizeSlider');
    var tabCurveBtn = document.getElementById('tabCurveBtn');
    var tabBounceBtn = document.getElementById('tabBounceBtn');
    var curveModePanel = document.getElementById('curveModePanel');
    var bounceModePanel = document.getElementById('bounceModePanel');
    var bounceGraphSvg = document.getElementById('bounceGraphSvg');
    var bounceGraphPath = document.getElementById('bounceGraphPath');
    var bounceBaselineLine = document.getElementById('bounceBaselineLine');
    var bounceLandingDot = document.getElementById('bounceLandingDot');
    var bounceEndDot = document.getElementById('bounceEndDot');
    var bounceBouncesSlider = document.getElementById('bounceBouncesSlider');
    var bounceDecaySlider = document.getElementById('bounceDecaySlider');
    var bounceBouncesValueInput = document.getElementById('bounceBouncesValueInput');
    var bounceDecayValueInput = document.getElementById('bounceDecayValueInput');
    var btnApplyBounce = document.getElementById('btnApplyBounce');

    // El panel ya no muestra ningún rastro de "estado/ejecución" en la
    // interfaz (antes había una barra de texto abajo tipo "Ready",
    // "Applying curve...", etc). Se deja la función como no-op para no
    // tener que tocar el resto del código que la sigue llamando.
    function showStatus(msg) {}

    // ---------------------------------------------------------------
    // Estado de la curva actual + dibujo/arrastre del editor
    // ---------------------------------------------------------------
    var curve = { x1: state.currentCurve.x1, y1: state.currentCurve.y1, x2: state.currentCurve.x2, y2: state.currentCurve.y2 };
    var draggingHandle = null;

    // Guarda la curva actual del editor en el estado persistido. Se llama
    // solo en los puntos donde un cambio "se asienta" (soltar el mouse,
    // confirmar el input de texto, cargar un preset, leer de AE) y no en
    // cada frame de un arrastre, igual que ya hace el resize del editor.
    function persistCurrentCurve() {
        state.currentCurve = { x1: curve.x1, y1: curve.y1, x2: curve.x2, y2: curve.y2 };
        saveStateToDisk();
    }
    var activePresetIndex = -1; // índice dentro de las curvas del grupo activo, para prev/next

    // El viewBox del SVG se queda fijo en "0 0 100 100"; lo que cambia es
    // este mapeo curva <-> svg, recalculado en cada redraw para encajar
    // (con aspecto 1:1, sin deformar) tanto la caja normal [0,1] como el
    // overshoot actual de los handles. Así el editor hace "auto zoom out"
    // igual que Flow cuando un handle sale de la caja, en vez de recortar
    // la curva o estirarla de forma no uniforme. El rectángulo punteado
    // (curveBoundsRect) marca siempre dónde están los límites normales
    // 0-1, para que se note claramente cuándo te sales de ellos.
    var viewBox = { xMin: 0, yMin: 0, range: 1 };

    function activeGroupCurves() {
        return getActiveGroup().curves;
    }

    function computeViewBox() {
        var margin = 0.12;
        var yMin = Math.min(0, curve.y1, curve.y2) - margin;
        var yMax = Math.max(1, curve.y1, curve.y2) + margin;
        var range = yMax - yMin;
        var xMin = 0.5 - range / 2; // centra el eje X (0..1) dentro del rango cuadrado
        return { xMin: xMin, yMin: yMin, range: range };
    }

    function toSvg(x, y) {
        return {
            sx: (x - viewBox.xMin) / viewBox.range * 100,
            sy: (1 - (y - viewBox.yMin) / viewBox.range) * 100
        };
    }

    function toNorm(sx, sy) {
        return {
            x: viewBox.xMin + (sx / 100) * viewBox.range,
            y: viewBox.yMin + (1 - sy / 100) * viewBox.range
        };
    }

    function redrawCurve() {
        viewBox = computeViewBox();

        var p0 = toSvg(0, 0);
        var p1 = toSvg(curve.x1, curve.y1);
        var p2 = toSvg(curve.x2, curve.y2);
        var p3 = toSvg(1, 1);

        // Rectángulo punteado = límites normales 0..1 del gráfico.
        var boundsTopLeft = toSvg(0, 1);
        var boundsBottomRight = toSvg(1, 0);
        curveBoundsRect.setAttribute('x', boundsTopLeft.sx);
        curveBoundsRect.setAttribute('y', boundsTopLeft.sy);
        curveBoundsRect.setAttribute('width', boundsBottomRight.sx - boundsTopLeft.sx);
        curveBoundsRect.setAttribute('height', boundsBottomRight.sy - boundsTopLeft.sy);

        handle1.setAttribute('cx', p1.sx);
        handle1.setAttribute('cy', p1.sy);
        handle2.setAttribute('cx', p2.sx);
        handle2.setAttribute('cy', p2.sy);

        handle1Guide.setAttribute('x1', p0.sx);
        handle1Guide.setAttribute('y1', p0.sy);
        handle1Guide.setAttribute('x2', p1.sx);
        handle1Guide.setAttribute('y2', p1.sy);

        handle2Guide.setAttribute('x1', p3.sx);
        handle2Guide.setAttribute('y1', p3.sy);
        handle2Guide.setAttribute('x2', p2.sx);
        handle2Guide.setAttribute('y2', p2.sy);

        curveEditorPath.setAttribute('d',
            'M' + p0.sx + ',' + p0.sy +
            ' C' + p1.sx + ',' + p1.sy + ' ' + p2.sx + ',' + p2.sy + ' ' + p3.sx + ',' + p3.sy);

        // No pisamos el campo mientras el usuario lo está editando, para
        // no interrumpirle el valor a medio escribir.
        if (document.activeElement !== curveValuesInput) {
            curveValuesInput.value = curve.x1.toFixed(2) + ', ' + curve.y1.toFixed(2) + ', ' +
                curve.x2.toFixed(2) + ', ' + curve.y2.toFixed(2);
        }
    }

    // ---------------------------------------------------------------
    // Edición manual de los 4 valores de la curva desde un único input
    // de texto, en formato "x1, y1, x2, y2"
    // ---------------------------------------------------------------
    function commitCurveInputs() {
        var parts = curveValuesInput.value.split(',').map(function (s) { return parseFloat(s.trim()); });

        if (parts.length !== 4 || parts.some(function (n) { return isNaN(n); })) {
            redrawCurve(); // revierte al texto con los valores válidos actuales
            return;
        }

        activePresetIndex = -1;
        setCurve(parts[0], parts[1], parts[2], parts[3]);
        persistCurrentCurve();
        renderCurvesGrid();
    }

    function bindCurveInputs() {
        curveValuesInput.addEventListener('change', commitCurveInputs);
        curveValuesInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') curveValuesInput.blur();
        });
    }

    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    function setCurve(x1, y1, x2, y2) {
        curve.x1 = clamp(x1, 0, 1);
        curve.y1 = clamp(y1, CURVE_Y_MIN, CURVE_Y_MAX);
        curve.x2 = clamp(x2, 0, 1);
        curve.y2 = clamp(y2, CURVE_Y_MIN, CURVE_Y_MAX);
        redrawCurve();
    }

    // ---------------------------------------------------------------
    // Menú contextual del editor de curva (clic derecho) + "Reverse value"
    // ---------------------------------------------------------------
    // Invierte la curva actual "rotándola" al lado contrario: refleja los
    // dos handles a través del centro del cuadro (0.5, 0.5), intercambiando
    // además cuál pasa a ser el de salida y cuál el de entrada. Es la
    // misma operación que usan la mayoría de editores de easing para
    // invertir el sentido de una curva sin cambiarle la forma.
    function reverseCurrentCurve() {
        var nx1 = 1 - curve.x2, ny1 = 1 - curve.y2;
        var nx2 = 1 - curve.x1, ny2 = 1 - curve.y1;
        activePresetIndex = -1; // deja de ser "la curva X" del grupo activo
        setCurve(nx1, ny1, nx2, ny2);
        persistCurrentCurve();
        renderCurvesGrid();
    }

    function hideCurveContextMenu() {
        curveContextMenu.hidden = true;
    }

    function showCurveContextMenu(clientX, clientY) {
        curveContextMenu.hidden = false;
        // Se posiciona primero para poder medir su tamaño real y no
        // dejarlo colgando fuera del panel si el clic fue cerca del borde.
        var menuRect = curveContextMenu.getBoundingClientRect();
        var maxX = window.innerWidth - menuRect.width - 4;
        var maxY = window.innerHeight - menuRect.height - 4;
        curveContextMenu.style.left = Math.max(4, Math.min(clientX, maxX)) + 'px';
        curveContextMenu.style.top = Math.max(4, Math.min(clientY, maxY)) + 'px';
    }

    svg.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showCurveContextMenu(e.clientX, e.clientY);
    });

    btnReverseCurve.addEventListener('click', function () {
        reverseCurrentCurve();
        hideCurveContextMenu();
    });

    document.addEventListener('mousedown', function (e) {
        if (!curveContextMenu.hidden && !curveContextMenu.contains(e.target)) hideCurveContextMenu();
    });
    document.addEventListener('scroll', hideCurveContextMenu, true);

    function clientToNorm(evt) {
        var rect = svg.getBoundingClientRect();
        var sx = (evt.clientX - rect.left) / rect.width * 100;
        var sy = (evt.clientY - rect.top) / rect.height * 100;
        var p = toNorm(sx, sy);
        p.x = clamp(p.x, 0, 1);                     // el tiempo no puede salirse de 0-1
        p.y = clamp(p.y, CURVE_Y_MIN, CURVE_Y_MAX);  // el valor sí puede pasarse (overshoot/back)
        return p;
    }

    handle1.addEventListener('mousedown', function (e) { e.preventDefault(); draggingHandle = 1; });
    handle2.addEventListener('mousedown', function (e) { e.preventDefault(); draggingHandle = 2; });

    document.addEventListener('mousemove', function (e) {
        if (!draggingHandle) return;
        var p = clientToNorm(e);
        if (draggingHandle === 1) { curve.x1 = p.x; curve.y1 = p.y; }
        else { curve.x2 = p.x; curve.y2 = p.y; }
        activePresetIndex = -1; // al tocar el editor a mano, deja de ser "la curva X"
        redrawCurve();
    });

    document.addEventListener('mouseup', function () {
        if (draggingHandle) persistCurrentCurve(); // solo al soltar, no en cada frame del arrastre
        draggingHandle = null;
    });

    // ---------------------------------------------------------------
    // Redimensionado manual del editor de curva (arrastrando la esquina).
    // Cambia el tamaño COMPLETO del cuadro (ancho y alto a la vez, en
    // proporción 1:1), nunca solo el alto — así crece/achica el editor
    // en vez de deformarlo en un rectángulo. No toca curve, handles, ni
    // ningún valor de la curva.
    // ---------------------------------------------------------------
    var resizingCurveEditor = false;
    var resizeStartClientX = 0;
    var resizeStartClientY = 0;
    var resizeStartSize = 0;

    function setCurveEditorSize(px) {
        // Nunca más ancho que el panel disponible, para que el cuadro no
        // se salga ni provoque scroll horizontal.
        var maxAvailable = Math.min(CURVE_EDITOR_MAX_SIZE, curveEditorCanvasWrap.clientWidth || CURVE_EDITOR_MAX_SIZE);
        var clamped = clamp(px, CURVE_EDITOR_MIN_SIZE, maxAvailable);
        document.documentElement.style.setProperty('--curve-editor-size', clamped + 'px');
        return clamped;
    }

    curveResizeHandle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        resizingCurveEditor = true;
        resizeStartClientX = e.clientX;
        resizeStartClientY = e.clientY;
        resizeStartSize = svg.getBoundingClientRect().width;
        curveResizeHandle.classList.add('is-resizing');
    });

    document.addEventListener('mousemove', function (e) {
        if (!resizingCurveEditor) return;
        // Promedio de lo arrastrado en X e Y: crece igual si arrastrás en
        // diagonal, y también responde si solo movés en un eje.
        var delta = ((e.clientX - resizeStartClientX) + (e.clientY - resizeStartClientY)) / 2;
        setCurveEditorSize(resizeStartSize + delta);
    });

    document.addEventListener('mouseup', function () {
        if (!resizingCurveEditor) return;
        resizingCurveEditor = false;
        curveResizeHandle.classList.remove('is-resizing');
        state.curveEditorSize = Math.round(svg.getBoundingClientRect().width);
        saveStateToDisk();
    });

    // ---------------------------------------------------------------
    // Aplicar a la selección
    // ---------------------------------------------------------------
    function applyCurrentCurve() {
        if (!csInterface) return;

        var isLinear = (curve.x1 === 0 && curve.y1 === 0 && curve.x2 === 1 && curve.y2 === 1);
        showStatus('Applying curve...');

        var script = isLinear
            ? 'applyLinearToSelectedKeyframes()'
            : 'applyBezierCurveToSelectedKeyframes(' + curve.x1 + ',' + curve.y1 + ',' + curve.x2 + ',' + curve.y2 + ')';

        csInterface.evalScript(script, function (res) {
            if (res === 'NO_COMP') { showStatus('Open a composition first.'); return; }
            if (res === 'NO_KEYFRAMES_SELECTED') { showStatus('Select some keyframes first.'); return; }
            if (res === 'NEED_TWO_ADJACENT_KEYFRAMES') { showStatus('Select at least 2 keyframes on the same property.'); return; }
            if (res === 'PAIRS_NOT_CONSECUTIVE') { showStatus('Select pairs of consecutive keyframes (e.g. K1+K2, K3+K4) — non-adjacent pairs are skipped.'); return; }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ('Error: ' + res.substring(0, 120)) : 'Could not apply curve.');
                return;
            }
            var count = res.indexOf('OK:') === 0 ? res.substring(3) : '?';
            showStatus('Curve applied to ' + count + ' segment(s)/keyframe(s).');
        });
    }

    // ---------------------------------------------------------------
    // Leer una curva ya existente entre dos keyframes seleccionados
    // ---------------------------------------------------------------
    function readCurveFromSelection() {
        if (!csInterface) return;
        showStatus('Reading curve from selection...');

        csInterface.evalScript('readCurveFromSelectedKeyframes()', function (res) {
            if (res === 'NO_COMP') { showStatus('Open a composition first.'); return; }
            if (res === 'NO_KEYFRAMES_SELECTED') { showStatus('Select some keyframes first.'); return; }
            if (res === 'NEED_TWO_ADJACENT_KEYFRAMES') { showStatus('Select at least 2 consecutive keyframes on one property.'); return; }
            if (res === 'HOLD_NOT_SUPPORTED') { showStatus('Hold keyframes have no curve to read.'); return; }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ('Error: ' + res.substring(0, 120)) : 'Could not read curve.');
                return;
            }
            if (res.indexOf('OK:') !== 0) { showStatus('Unexpected response.'); return; }

            var parts = res.substring(3).split(',');
            if (parts.length !== 4) { showStatus('Unexpected curve data.'); return; }

            var x1 = parseFloat(parts[0]), y1 = parseFloat(parts[1]),
                x2 = parseFloat(parts[2]), y2 = parseFloat(parts[3]);

            if ([x1, y1, x2, y2].some(function (n) { return isNaN(n); })) {
                showStatus('Unexpected curve data.');
                return;
            }

            activePresetIndex = -1;
            setCurve(x1, y1, x2, y2);
            persistCurrentCurve();
            renderCurvesGrid();
            showStatus('Curve read from selected keyframes.');
        });
    }

    // ---------------------------------------------------------------
    // Grid de curvas del grupo activo — clic = CARGAR en editor
    // ---------------------------------------------------------------
    function makeIconSvg(preset) {
        var margin = 0.12;
        var yMin = Math.min(0, preset.y1, preset.y2) - margin;
        var yMax = Math.max(1, preset.y1, preset.y2) + margin;
        var range = yMax - yMin;
        var xMin = 0.5 - range / 2;

        function map(x, y) {
            return {
                sx: 4 + ((x - xMin) / range) * 92,
                sy: 56 - ((y - yMin) / range) * 52
            };
        }

        var p0 = map(0, 0), p1 = map(preset.x1, preset.y1), p2 = map(preset.x2, preset.y2), p3 = map(1, 1);
        var d = 'M' + p0.sx + ',' + p0.sy + ' C' + p1.sx + ',' + p1.sy + ' ' + p2.sx + ',' + p2.sy + ' ' + p3.sx + ',' + p3.sy;
        return '<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg">' +
            '<line x1="' + p0.sx + '" y1="' + p0.sy + '" x2="' + p1.sx + '" y2="' + p1.sy + '" class="ease-icon-guide"></line>' +
            '<line x1="' + p3.sx + '" y1="' + p3.sy + '" x2="' + p2.sx + '" y2="' + p2.sy + '" class="ease-icon-guide"></line>' +
            '<path d="' + d + '" stroke="currentColor" fill="none" stroke-width="4.5" stroke-linecap="round" />' +
            '<circle class="ease-icon-handle" cx="' + p1.sx + '" cy="' + p1.sy + '" r="4"></circle>' +
            '<circle class="ease-icon-handle" cx="' + p2.sx + '" cy="' + p2.sy + '" r="4"></circle>' +
            '</svg>';
    }

    function renderCurvesGrid() {
        curvesGrid.innerHTML = '';
        var group = getActiveGroup();
        var editable = !group.builtin;

        if (!group.curves || group.curves.length === 0) {
            curvesGrid.innerHTML = '<div class="ease-empty">No curves in this group yet. Edit a curve above and press ★ to save it here.</div>';
            return;
        }

        group.curves.forEach(function (preset, idx) {
            curvesGrid.appendChild(buildPresetCard(preset, idx, { deletable: editable, renamable: editable, curveIdx: idx }));
        });
    }

    function buildPresetCard(preset, combinedIdx, opts) {
        opts = opts || {};
        var card = document.createElement('div');
        card.className = 'ease-card';
        if (combinedIdx === activePresetIndex) card.classList.add('active');

        var iconBox = document.createElement('div');
        iconBox.className = 'ease-icon-box';
        iconBox.innerHTML = makeIconSvg(preset);

        var name = document.createElement('div');
        name.className = 'ease-name';
        name.textContent = preset.name;
        name.title = preset.name;

        card.appendChild(iconBox);
        card.appendChild(name);

        if (opts.renamable) {
            var renameBtn = document.createElement('button');
            renameBtn.className = 'ease-card-rename';
            renameBtn.title = 'Rename curve';
            renameBtn.textContent = '✎';
            renameBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var newName = prompt('Rename curve:', preset.name);
                if (!newName || !newName.trim()) return;
                preset.name = newName.trim();
                saveStateToDisk();
                renderCurvesGrid();
                showStatus('Curve renamed.');
            });
            card.appendChild(renameBtn);
        }

        if (opts.deletable) {
            var delBtn = document.createElement('button');
            delBtn.className = 'ease-card-delete';
            delBtn.title = 'Remove curve';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                var group = getActiveGroup();
                group.curves.splice(opts.curveIdx, 1);
                saveStateToDisk();
                activePresetIndex = -1;
                renderCurvesGrid();
                renderGroupSelect();
                showStatus('Curve removed.');
            });
            card.appendChild(delBtn);
        }

        card.addEventListener('click', function () {
            loadPresetIntoEditor(combinedIdx);
        });

        return card;
    }

    function loadPresetIntoEditor(idx) {
        var list = activeGroupCurves();
        if (!list.length) return;
        if (idx < 0) idx = list.length - 1;
        if (idx >= list.length) idx = 0;

        var preset = list[idx];
        activePresetIndex = idx;
        setCurve(preset.x1, preset.y1, preset.x2, preset.y2);
        persistCurrentCurve();
        showStatus('Loaded: ' + preset.name);

        renderCurvesGrid();
    }

    // ---------------------------------------------------------------
    // Prev / Next / Guardar en el grupo activo
    // ---------------------------------------------------------------
    btnPrevPreset.addEventListener('click', function () {
        var list = activeGroupCurves();
        if (!list.length) return;
        var next = activePresetIndex <= 0 ? list.length - 1 : activePresetIndex - 1;
        loadPresetIntoEditor(next);
    });

    btnNextPreset.addEventListener('click', function () {
        var list = activeGroupCurves();
        if (!list.length) return;
        var next = activePresetIndex < 0 ? 0 : (activePresetIndex + 1) % list.length;
        loadPresetIntoEditor(next);
    });

    btnFavCurve.addEventListener('click', function () {
        var group = getActiveGroup();
        if (group.builtin) {
            showStatus('Choose or create a custom group to save curves into.');
            return;
        }
        var name = prompt('Name for this curve (will be saved into "' + group.name + '"):', 'My Curve');
        if (!name || name.trim() === '') return;

        group.curves.push({
            id: makeId('crv'),
            name: name.trim(),
            x1: curve.x1, y1: curve.y1, x2: curve.x2, y2: curve.y2
        });
        saveStateToDisk();
        renderCurvesGrid();
        renderGroupSelect();
        showStatus('Curve saved into "' + group.name + '".');
    });

    btnApplyCurve.addEventListener('click', applyCurrentCurve);
    btnReadCurve.addEventListener('click', readCurveFromSelection);

    // ---------------------------------------------------------------
    // Grupos (crear / renombrar / eliminar) — "Built-in" es de solo lectura
    // ---------------------------------------------------------------
    function renderGroupSelect() {
        groupSelect.innerHTML = '';
        state.library.groups.forEach(function (g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = (g.builtin ? '🔒 ' : '') + g.name;
            if (g.id === state.activeGroupId) opt.selected = true;
            groupSelect.appendChild(opt);
        });

        var activeGroup = getActiveGroup();
        btnRenameGroup.disabled = !!activeGroup.builtin;
        btnDeleteGroup.disabled = !!activeGroup.builtin;
    }

    groupSelect.addEventListener('change', function () {
        state.activeGroupId = groupSelect.value;
        activePresetIndex = -1;
        saveStateToDisk();
        renderGroupSelect();
        renderCurvesGrid();
    });

    btnAddGroup.addEventListener('click', function () {
        var name = prompt('Name for the new group:', 'New Group');
        if (!name || !name.trim()) return;
        var group = { id: makeId('grp'), name: name.trim(), curves: [] };
        state.library.groups.push(group);
        state.activeGroupId = group.id;
        activePresetIndex = -1;
        saveStateToDisk();
        renderGroupSelect();
        renderCurvesGrid();
        showStatus('Group created: ' + group.name);
    });

    btnRenameGroup.addEventListener('click', function () {
        var group = getActiveGroup();
        if (group.builtin) return;
        var name = prompt('Rename group:', group.name);
        if (!name || !name.trim()) return;
        group.name = name.trim();
        saveStateToDisk();
        renderGroupSelect();
        showStatus('Group renamed.');
    });

    btnDeleteGroup.addEventListener('click', function () {
        var group = getActiveGroup();
        if (group.builtin) return;

        var confirmed = confirm('Delete group "' + group.name + '" and its ' + group.curves.length + ' curve(s)? This cannot be undone.');
        if (!confirmed) return;

        state.library.groups = state.library.groups.filter(function (g) { return g.id !== group.id; });
        var hasCustomGroup = state.library.groups.some(function (g) { return !g.builtin; });
        if (!hasCustomGroup) {
            state.library.groups.push({ id: makeId('grp'), name: 'My Curves', curves: [] });
        }
        state.activeGroupId = state.library.groups[0].id;
        activePresetIndex = -1;
        saveStateToDisk();
        renderGroupSelect();
        renderCurvesGrid();
        showStatus('Group deleted.');
    });

    // ---------------------------------------------------------------
    // Import / Export de la biblioteca completa (.flow), con diálogo
    // nativo de guardar/abrir a través de ExtendScript (host/main.jsx).
    // El grupo "Built-in" nunca se exporta ni se importa: no es dato
    // del usuario, siempre está disponible igual en cualquier instalación.
    // ---------------------------------------------------------------
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Formato plano/compatible: un array de { name, value: [x1,y1,x2,y2] },
    // como el que usan otras herramientas de easing (p. ej. archivos .flow
    // exportados fuera de Vantyx Flow, sin la noción de "grupos").
    function isFlatCurveArray(arr) {
        return Array.isArray(arr) && arr.every(function (c) {
            return c && typeof c === 'object' &&
                typeof c.name === 'string' &&
                Array.isArray(c.value) && c.value.length === 4 &&
                c.value.every(function (n) { return typeof n === 'number' && isFinite(n); });
        });
    }

    function isValidLibraryShape(obj) {
        return obj && typeof obj === 'object' && Array.isArray(obj.groups) && obj.groups.every(function (g) {
            return g && typeof g.name === 'string' && Array.isArray(g.curves) && g.curves.every(function (c) {
                return c && typeof c.name === 'string' &&
                    typeof c.x1 === 'number' && typeof c.y1 === 'number' &&
                    typeof c.x2 === 'number' && typeof c.y2 === 'number';
            });
        });
    }

    function sanitizeImportedGroups(obj) {
        return obj.groups.map(function (g) {
            return {
                id: makeId('grp'),
                name: String(g.name),
                curves: g.curves.map(function (c) {
                    return {
                        id: makeId('crv'),
                        name: String(c.name),
                        x1: Number(c.x1), y1: Number(c.y1),
                        x2: Number(c.x2), y2: Number(c.y2)
                    };
                })
            };
        });
    }

    btnExportLibrary.addEventListener('click', function () {
        if (!csInterface) return;

        var exportFlat = confirm(
            'Export in SIMPLE format (flat list of curves from the active group, ' +
            'compatible with .flow files from other tools)?\n\n' +
            'OK = Simple/compatible format\nCancel = Vantyx Flow format (all custom groups)'
        );

        var payload;
        if (exportFlat) {
            var activeGroup = getActiveGroup();
            var flatCurves = (activeGroup.curves || []).map(function (c) {
                return { _id: generateUUID(), name: c.name, value: [c.x1, c.y1, c.x2, c.y2] };
            });
            payload = JSON.stringify(flatCurves, null, 4);
        } else {
            var exportableLibrary = {
                formatId: LIBRARY_FORMAT_ID,
                formatVersion: LIBRARY_FORMAT_VERSION,
                groups: state.library.groups.filter(function (g) { return !g.builtin; })
            };
            payload = JSON.stringify(exportableLibrary, null, 2);
        }

        var encoded = encodeURIComponent(payload);

        showStatus('Choose where to save the library...');
        csInterface.evalScript('exportLibraryToFile("' + encoded + '")', function (res) {
            if (res === 'CANCELLED') { showStatus('Export cancelled.'); return; }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ('Error: ' + res.substring(0, 120)) : 'Could not export library.');
                return;
            }
            if (res.indexOf('OK:') === 0) {
                var path = decodeURIComponent(res.substring(3));
                showStatus('Library exported to: ' + path);
            }
        });
    });

    btnImportLibrary.addEventListener('click', function () {
        if (!csInterface) return;

        showStatus('Choose a .flow file to import...');
        csInterface.evalScript('importLibraryFromFile()', function (res) {
            if (res === 'CANCELLED') { showStatus('Import cancelled.'); return; }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ('Error: ' + res.substring(0, 120)) : 'Could not import library.');
                return;
            }
            if (res.indexOf('OK:') !== 0) { showStatus('Unexpected response.'); return; }

            var rest = res.substring(3);
            var sep = rest.indexOf('|||');
            if (sep === -1) { showStatus('Unexpected import data.'); return; }

            var path = decodeURIComponent(rest.substring(0, sep));
            var jsonText = decodeURIComponent(rest.substring(sep + 3));

            var parsed;
            try {
                parsed = JSON.parse(jsonText);
            } catch (e) {
                showStatus('Invalid .flow file (not valid JSON).');
                return;
            }

            // Formato plano/compatible (array de curvas sin grupos): se
            // añade como un grupo NUEVO, sin tocar los grupos existentes.
            if (Array.isArray(parsed)) {
                if (!isFlatCurveArray(parsed)) {
                    showStatus('Invalid .flow file (unexpected structure).');
                    return;
                }

                var flatCurves = parsed.map(function (c) {
                    return {
                        id: makeId('crv'),
                        name: String(c.name || 'Curve'),
                        x1: Number(c.value[0]), y1: Number(c.value[1]),
                        x2: Number(c.value[2]), y2: Number(c.value[3])
                    };
                });

                var fileBase = path.replace(/^.*[\\\/]/, '').replace(/\.flow$/i, '') || 'Imported';
                var groupName = prompt(
                    'Import ' + flatCurves.length + ' curve(s) into a new group named:',
                    fileBase
                );
                if (!groupName || !groupName.trim()) { showStatus('Import cancelled.'); return; }

                var flatGroup = { id: makeId('grp'), name: groupName.trim(), curves: flatCurves };
                state.library.groups.push(flatGroup);
                state.activeGroupId = flatGroup.id;
                activePresetIndex = -1;
                saveStateToDisk();
                renderGroupSelect();
                renderCurvesGrid();
                showStatus('Imported ' + flatCurves.length + ' curve(s) into "' + flatGroup.name + '".');
                return;
            }

            if (!isValidLibraryShape(parsed)) {
                showStatus('Invalid .flow file (unexpected structure).');
                return;
            }

            var importedGroups = sanitizeImportedGroups(parsed);
            var totalCurves = importedGroups.reduce(function (sum, g) { return sum + g.curves.length; }, 0);

            var confirmed = confirm('Import "' + path + '"?\n' +
                importedGroups.length + ' group(s), ' + totalCurves + ' curve(s).\n' +
                'This will REPLACE your current custom groups (Built-in stays untouched).');
            if (!confirmed) return;

            state.library.groups = [builtinGroup()].concat(
                importedGroups.length ? importedGroups : [{ id: makeId('grp'), name: 'My Curves', curves: [] }]
            );
            state.activeGroupId = state.library.groups[state.library.groups.length > 1 ? 1 : 0].id;
            activePresetIndex = -1;
            saveStateToDisk();
            renderGroupSelect();
            renderCurvesGrid();
            showStatus('Library imported: ' + importedGroups.length + ' group(s), ' + totalCurves + ' curve(s).');
        });
    });

    // ---------------------------------------------------------------
    // Tamaño de las tarjetas de curva (achicar/agrandar)
    // ---------------------------------------------------------------
    presetSizeSlider.addEventListener('input', function () {
        var val = presetSizeSlider.value;
        document.documentElement.style.setProperty('--ease-card-size', val + 'px');
        state.presetCardSize = parseInt(val, 10);
        saveStateToDisk();
    });

    // ---------------------------------------------------------------
    // Pestañas de modo del panel: Curve (editor de curvas de siempre)
    // / Bounce (value graph de rebote). Comparten el mismo panel y el
    // mismo tamaño de cuadro (--curve-editor-size); solo se alterna
    // qué contenido se muestra.
    // ---------------------------------------------------------------
    function setEditorMode(mode) {
        var isBounce = mode === 'bounce';
        curveModePanel.hidden = isBounce;
        bounceModePanel.hidden = !isBounce;
        tabCurveBtn.classList.toggle('active', !isBounce);
        tabBounceBtn.classList.toggle('active', isBounce);
        if (isBounce) redrawBounce();
    }

    tabCurveBtn.addEventListener('click', function () { setEditorMode('curve'); });
    tabBounceBtn.addEventListener('click', function () { setEditorMode('bounce'); });

    // ---------------------------------------------------------------
    // Bounce (value graph) — genera un rebote amortiguado que se
    // reparte en el tramo ANTES del último keyframe seleccionado de
    // cada propiedad (entre el penúltimo y el último), de forma que
    // el aterrizaje final quede exactamente en ese último keyframe,
    // sin añadir tiempo extra después de él. Los picos van perdiendo
    // amplitud y separación temporal a medida que se acercan al final
    // (como una pelota que rebota cada vez más rápido y más bajo justo
    // antes de quedarse quieta en el sitio exacto donde ya estaba).
    // ---------------------------------------------------------------

    // Genera los puntos { t, v } de la vista previa, normalizados a
    // t en [0,1]: t=0 es el keyframe anterior (penúltimo seleccionado),
    // t=1 es el keyframe final (último seleccionado, sin tocar). "v"
    // representa aquí la fracción del delta original que se recupera
    // en sentido CONTRARIO al del último tramo: el primer rebote (b=0)
    // usa un peso de 1 (100% del delta, en sentido contrario), es decir
    // vuelve exactamente al valor "de antes" — por ejemplo, si el
    // último tramo reducía la escala, el primer rebote la sube de
    // nuevo hasta donde estaba — y los siguientes rebotes van perdiendo
    // esa fuerza geométricamente hasta apagarse justo al llegar al
    // keyframe final. Usa exactamente la misma progresión que
    // host/main.jsx aplica de verdad sobre los keyframes.
    function computeBouncePreviewPoints(bounces, decay) {
        var weights = [];
        var weightSum = 0;
        for (var i = 0; i < bounces; i++) {
            var w = Math.pow(decay, i);
            weights.push(w);
            weightSum += w;
        }

        var points = [{ t: 0, v: 0 }];
        var t = 0;
        for (var b = 0; b < bounces; b++) {
            var periodLen = (weights[b] / weightSum) * 1; // total normalizado = 1
            var ampScale = weights[b]; // 1 en el primer rebote, decayendo después
            var peakTime = t + periodLen * 0.5;
            var touchTime = t + periodLen;
            points.push({ t: peakTime, v: ampScale });
            points.push({ t: touchTime, v: 0 });
            t = touchTime;
        }
        return points;
    }

    function clampBounces(n) {
        n = Math.round(n);
        if (!isFinite(n)) n = 4;
        return Math.min(8, Math.max(1, n));
    }

    function clampDecay(n) {
        if (!isFinite(n)) n = 0.5;
        return Math.min(0.9, Math.max(0, n));
    }

    function redrawBounce() {
        var bounces = clampBounces(parseInt(bounceBouncesSlider.value, 10));
        var decay = clampDecay(parseFloat(bounceDecaySlider.value));

        state.bounceParams.bounces = bounces;
        state.bounceParams.decay = decay;

        var pts = computeBouncePreviewPoints(bounces, decay);
        var vMax = pts.reduce(function (m, p) { return Math.max(m, p.v); }, 0.0001);

        var marginX = 4;
        var baselineY = 90;
        var topY = 12;

        function map(p) {
            return {
                sx: marginX + p.t * (100 - marginX * 2),
                sy: baselineY - (p.v / vMax) * (baselineY - topY)
            };
        }

        var svgPts = pts.map(map);
        var d = 'M' + svgPts[0].sx + ',' + svgPts[0].sy;
        for (var i = 1; i < svgPts.length; i += 2) {
            var peak = svgPts[i];
            var touch = svgPts[i + 1] || peak;
            d += ' Q' + peak.sx + ',' + peak.sy + ' ' + touch.sx + ',' + touch.sy;
        }
        bounceGraphPath.setAttribute('d', d);
        bounceBaselineLine.setAttribute('y1', baselineY);
        bounceBaselineLine.setAttribute('y2', baselineY);
        bounceLandingDot.setAttribute('cx', svgPts[0].sx);
        bounceLandingDot.setAttribute('cy', svgPts[0].sy);
        bounceEndDot.setAttribute('cx', svgPts[svgPts.length - 1].sx);
        bounceEndDot.setAttribute('cy', svgPts[svgPts.length - 1].sy);
    }

    // ---- Sincronización slider <-> input numérico (ambos editan el
    // mismo valor; cada uno refleja al otro y redibuja el preview) ----
    function syncBounceInputsFromState() {
        bounceBouncesSlider.value = state.bounceParams.bounces;
        bounceDecaySlider.value = state.bounceParams.decay;
        if (document.activeElement !== bounceBouncesValueInput) {
            bounceBouncesValueInput.value = state.bounceParams.bounces;
        }
        if (document.activeElement !== bounceDecayValueInput) {
            bounceDecayValueInput.value = state.bounceParams.decay.toFixed(2);
        }
    }

    bounceBouncesSlider.addEventListener('input', function () {
        state.bounceParams.bounces = clampBounces(parseFloat(bounceBouncesSlider.value));
        syncBounceInputsFromState();
        redrawBounce();
        saveStateToDisk();
    });

    bounceDecaySlider.addEventListener('input', function () {
        state.bounceParams.decay = clampDecay(parseFloat(bounceDecaySlider.value));
        syncBounceInputsFromState();
        redrawBounce();
        saveStateToDisk();
    });

    function commitBounceBouncesInput() {
        state.bounceParams.bounces = clampBounces(parseFloat(bounceBouncesValueInput.value));
        syncBounceInputsFromState();
        redrawBounce();
        saveStateToDisk();
    }

    function commitBounceDecayInput() {
        state.bounceParams.decay = clampDecay(parseFloat(bounceDecayValueInput.value));
        syncBounceInputsFromState();
        redrawBounce();
        saveStateToDisk();
    }

    bounceBouncesValueInput.addEventListener('change', commitBounceBouncesInput);
    bounceBouncesValueInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') bounceBouncesValueInput.blur(); });

    bounceDecayValueInput.addEventListener('change', commitBounceDecayInput);
    bounceDecayValueInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') bounceDecayValueInput.blur(); });

    function applyCurrentBounce() {
        if (!csInterface) return;

        var bounces = state.bounceParams.bounces;
        var decay = state.bounceParams.decay;
        showStatus('Applying bounce...');

        var script = 'applyBounceToSelectedKeyframes(' + bounces + ',' + decay + ')';

        csInterface.evalScript(script, function (res) {
            if (res === 'NO_COMP') { showStatus('Open a composition first.'); return; }
            if (res === 'NO_KEYFRAMES_SELECTED') { showStatus('Select some keyframes first.'); return; }
            if (res === 'NEED_TWO_ADJACENT_KEYFRAMES') { showStatus('Select at least 2 keyframes on the same property (the bounce settles into the last one).'); return; }
            if (!res || res.indexOf('ERROR') === 0) {
                showStatus(res ? ('Error: ' + res.substring(0, 120)) : 'Could not apply bounce.');
                return;
            }
            var count = res.indexOf('OK:') === 0 ? res.substring(3) : '?';
            showStatus('Bounce applied: ' + count + ' keyframe(s) added.');
        });
    }

    btnApplyBounce.addEventListener('click', applyCurrentBounce);

    // ---------------------------------------------------------------
    // Init
    // ---------------------------------------------------------------
    function init() {
        presetSizeSlider.value = state.presetCardSize;
        document.documentElement.style.setProperty('--ease-card-size', state.presetCardSize + 'px');

        // Tamaño del editor de curva: si el usuario ya lo redimensionó
        // antes, se respeta ese valor guardado. Si no, arranca "cuadrado"
        // ocupando el ancho real del panel (igual que el comportamiento
        // original con aspect-ratio 1/1).
        var initialSize = state.curveEditorSize || curveEditorCanvasWrap.getBoundingClientRect().width || 280;
        state.curveEditorSize = setCurveEditorSize(initialSize);

        bindCurveInputs();
        redrawCurve();
        renderGroupSelect();
        renderCurvesGrid();

        bounceBouncesSlider.value = state.bounceParams.bounces;
        bounceDecaySlider.value = state.bounceParams.decay;
        syncBounceInputsFromState();
        redrawBounce();
    }

    document.addEventListener('DOMContentLoaded', init);

})();
