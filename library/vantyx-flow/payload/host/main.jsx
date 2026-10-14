// =========================================================
//  Vantyx Flow - host/main.jsx
//  Aplica una curva bezier (x1,y1,x2,y2 estilo CSS cubic-bezier)
//  a los keyframes seleccionados, convirtiéndola matemáticamente
//  al modelo real de ease de After Effects (influencia % +
//  velocidad absoluta por lado), usando el delta real de valor
//  y tiempo de cada par de keyframes consecutivos seleccionados.
//
//  También incluye la operación inversa: leer la interpolación
//  ya existente entre dos keyframes seleccionados y reconstruir
//  una curva bezier (x1,y1,x2,y2) editable en el panel, para
//  poder "importar" una animación ya hecha a mano dentro de la
//  herramienta (botón "Read" del panel).
// =========================================================

function easeDimensionsForProperty(prop) {
    try {
        switch (prop.propertyValueType) {
            case PropertyValueType.ThreeD:
            case PropertyValueType.ThreeD_SPATIAL:
                return 3;
            case PropertyValueType.TwoD:
            case PropertyValueType.TwoD_SPATIAL:
                return 2;
            default:
                return 1;
        }
    } catch (e) {
        return 1;
    }
}

function getPropertiesWithSelectedKeyframes(comp) {
    var result = [];
    var seen = [];

    function addIfSelected(p) {
        if (!p) return;
        try {
            if (p.propertyType !== PropertyType.PROPERTY) return;
            if (!p.canVaryOverTime || p.numKeys === 0) return;
            var selKeys = p.selectedKeys;
            if (!selKeys || selKeys.length === 0) return;

            for (var q = 0; q < seen.length; q++) {
                if (seen[q] === p) return;
            }
            seen.push(p);
            result.push(p);
        } catch (e) {}
    }

    // Mantener exactamente la detección original para todas las propiedades.
    var props = comp.selectedProperties;
    if (props) {
        for (var i = 0; i < props.length; i++) addIfSelected(props[i]);
    }

    // ÚNICO añadido: Position sin Separate Dimensions.
    // AE puede no devolver Position espacial en selectedProperties aunque
    // sus keyframes estén seleccionados. Buscamos la Position real de cada
    // capa y SOLO la añadimos si esa Position tiene keyframes seleccionados.
    // Así no se aplica nada a otras propiedades ni se cambia el resto del plugin.
    for (var li = 1; li <= comp.numLayers; li++) {
        try {
            var layer = comp.layer(li);
            if (!layer) continue;
            var transform = layer.property("ADBE Transform Group");
            if (!transform) continue;
            var position = transform.property("ADBE Position");
            addIfSelected(position);
        } catch (ePos) {}
    }

    return result;
}

// --- Valores numéricos simples (number, o array/objeto tipo array de
//     numbers): son los únicos que este script sabe interpolar como
//     ease bezier. Shape Path, Mask Path, Text Document, Markers, etc.
//     devuelven objetos que NO son esto, y restarlos entre sí da NaN o
//     resultados sin sentido, así que se detectan y se saltan ANTES de
//     intentar tocar la interpolación. ---
function isNumericKeyValue(v) {
    if (typeof v === "number") return isFinite(v);
    if (v && typeof v.length === "number") {
        if (v.length === 0) return false;
        for (var i = 0; i < v.length; i++) {
            if (typeof v[i] !== "number" || !isFinite(v[i])) return false;
        }
        return true;
    }
    return false;
}

// --- Propiedad con una expresión activa: After Effects no permite
//     cambiar el tipo de interpolación ni la ease de sus keyframes por
//     script mientras la expresión está habilitada (lanza excepción).
//     Se detecta antes para no gastar intentos que van a fallar seguro. ---
function hasActiveExpression(prop) {
    try {
        return !!prop.expressionEnabled;
    } catch (e) {
        return false;
    }
}

// Ratio máximo permitido entre "cuánto se mueve el valor" (y) y "cuánto
// tiempo tarda" (x, ya con el suelo de 0.1% de influencia que exige AE
// aplicado) al convertir un handle bezier a velocidad absoluta de AE.
// Tiene que cubrir el caso más extremo posible dentro del rango de la
// curva (y hasta CURVE_Y_MAX/CURVE_Y_MIN) con el x más pequeño posible
// (el suelo real de influencia, 0.001 = 0.1%): 1.75 / 0.001 = 1750. Se
// deja algo de margen por redondeo. Con este valor, cualquier curva
// dentro de los límites que permite el editor se reproduce con su altura
// real, sin recortes; solo en combinaciones verdaderamente extremas
// (segmento muy corto + rango de valor muy chico + handle pegado del
// todo a la pared) podría llegar a pedirle a AE una velocidad que
// rechace para ese keyframe puntual.
var MAX_EASE_RATIO = 1800;

// Convierte un control point normalizado (x1,y1)/(x2,y2) de un segmento
// cubic-bezier al par (influencia %, velocidad absoluta) que entiende AE,
// usando el delta real de valor y tiempo de ESE segmento concreto.
function bezierControlToAEEase(x, y, valueDelta, timeDelta, isOutgoing) {
    var influence;
    var speed;
    var ratio;
    var xInf;

    if (isOutgoing) {
        influence = Math.min(100, Math.max(0.1, x * 100));
        // xInf es la fracción de tiempo que REALMENTE se le pasa a AE como
        // influencia (ya con el suelo de 0.1% aplicado). Hay que usar este
        // valor, y no el x crudo del handle, como referencia para calcular
        // cuánta velocidad hace falta para alcanzar la altura "y" pedida:
        // si se usa el x crudo (que puede ser 0) mientras a AE se le manda
        // 0.1%, la altura resultante queda muy por debajo de la pedida.
        xInf = influence / 100;
        ratio = (Math.abs(y) <= 0.0008) ? 0 : Math.min(MAX_EASE_RATIO, Math.abs(y) / xInf);
        // IMPORTANTE: conservar el signo real del delta. AE necesita una
        // velocidad negativa cuando el tramo va hacia abajo (p.ej. 100 -> 95)
        // y positiva cuando va hacia arriba (p.ej. 100 -> 105). Solo el ratio
        // que describe la FORMA de la curva se calcula en positivo.
        speed = ratio * (valueDelta / timeDelta);
    } else {
        influence = Math.min(100, Math.max(0.1, (1 - x) * 100));
        // Mismo razonamiento en el extremo de entrada: la influencia real
        // corresponde a (1 - x) ya con el suelo aplicado, así que la
        // referencia para la altura "1 - y" tiene que ser esa, no (1 - x)
        // crudo.
        xInf = influence / 100;
        ratio = (Math.abs(1 - y) <= 0.0008) ? 0 : Math.min(MAX_EASE_RATIO, Math.abs(1 - y) / xInf);
        // IMPORTANTE: conservar el signo real del delta. AE necesita una
        // velocidad negativa cuando el tramo va hacia abajo (p.ej. 100 -> 95)
        // y positiva cuando va hacia arriba (p.ej. 100 -> 105). Solo el ratio
        // que describe la FORMA de la curva se calcula en positivo.
        speed = ratio * (valueDelta / timeDelta);
    }

    if (!isFinite(speed)) speed = 0;
    return { influence: influence, speed: speed };
}

// --- Operación inversa de bezierControlToAEEase: a partir de la
//     influencia (%) y la velocidad (CON SU SIGNO REAL) que ya tiene un
//     keyframe, reconstruye el control point normalizado (x,y) del segmento.
//     El signo de la velocidad permite recuperar correctamente la dirección
//     del tramo: positiva si el valor asciende y negativa si desciende.
function aeEaseToBezierControl(influence, speed, valueDelta, timeDelta, isOutgoing) {
    // Mantener el signo real del movimiento al reconstruir la curva.
    var rate = valueDelta / timeDelta;
    var absRate = Math.abs(rate);
    var sign = (rate < 0) ? -1 : 1;
    var signedSpeed = speed * sign;
    var x, y;

    if (isOutgoing) {
        x = Math.min(1, Math.max(0.0001, influence / 100));
        y = (signedSpeed === 0 || absRate === 0) ? 0 : (signedSpeed / absRate) * x;
    } else {
        var xIn = Math.min(1, Math.max(0.0001, influence / 100));
        x = 1 - xIn;
        y = (signedSpeed === 0 || absRate === 0) ? 1 : 1 - (signedSpeed / absRate) * xIn;
    }

    return { x: x, y: y };
}

// --- Aplica la curva bezier (x1,y1,x2,y2) a cada segmento formado por
//     pares CONSECUTIVOS de keyframes seleccionados, en cada propiedad
//     con keyframes seleccionados. ---
// Aplica temporal ease directamente a una propiedad espacial (Position)
// sin separar dimensiones. AE acepta un KeyframeEase por eje.
function applyTemporalEaseToSpatialKey(prop, keyIndex, inEase, outEase) {
    try { prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch (eType) {}
    try { prop.setTemporalAutoBezierAtKey(keyIndex, false); } catch (eAuto) {}
    try { prop.setTemporalContinuousAtKey(keyIndex, false); } catch (eCont) {}
    prop.setTemporalEaseAtKey(keyIndex, inEase, outEase);
    return true;
}

function applyBezierCurveToSelectedKeyframes(x1, y1, x2, y2) {
    app.beginUndoGroup("Vantyx Flow: apply curve");
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            app.endUndoGroup();
            return "NO_COMP";
        }
        var comp = app.project.activeItem;

        var props = getPropertiesWithSelectedKeyframes(comp);
        if (props.length === 0) {
            app.endUndoGroup();
            return "NO_KEYFRAMES_SELECTED";
        }

        var appliedSegments = 0;
        var sawSingleKeyOnly = false;
        var sawNonConsecutivePair = false;

        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var dims = easeDimensionsForProperty(prop);

            if (hasActiveExpression(prop)) continue;

            var selKeys = prop.selectedKeys.slice();
            selKeys.sort(function (a, b) { return a - b; });

            if (selKeys.length < 2) { sawSingleKeyOnly = true; continue; }

            // ---- PASO 1: calcular, sin tocar todavía nada en AE, la ease
            // "in"/"out" que le corresponde a cada keyframe involucrado.
            //
            // Esto es importante cuando hay 3+ keyframes seleccionados
            // seguidos (K1,K2,K3,...): un keyframe del medio (p.ej. K2)
            // participa en DOS tramos a la vez (como final de K1→K2 y
            // como inicio de K2→K3). Si se llamara a
            // setInterpolationTypeAtKey/setTemporalEaseAtKey sobre ese
            // keyframe una vez por cada tramo (como se hacía antes), la
            // segunda llamada puede resetear internamente en AE la ease
            // que ya se le había calculado en la primera pasada, y esa
            // ease "reseteada" terminaba guardándose por error como si
            // fuera el valor a conservar. Por eso ahora se calcula TODO
            // primero (por keyframe, no por tramo) y recién al final se
            // toca cada keyframe una única vez con su ease ya combinada.
            var pendingIn = {};   // keyIndex -> array de KeyframeEase (entrante), o undefined
            var pendingOut = {};  // keyIndex -> array de KeyframeEase (saliente), o undefined
            var touchedKeys = [];
            var touchedSet = {};
            var segCount = 0;

            for (var s = 0; s + 1 < selKeys.length; s++) {
                var keyA = selKeys[s];
                var keyB = selKeys[s + 1];

                // Cada tramo debe darse entre DOS KEYFRAMES REALMENTE
                // CONSECUTIVOS de esa propiedad (sin ningún otro keyframe
                // sin seleccionar en medio). Si no lo son (por ejemplo,
                // seleccionaste K1 y K4 salteando K2 y K3 sin seleccionar),
                // no se puede aplicar ahí una curva de un solo segmento sin
                // corromper los tramos intermedios reales, así que ese par
                // se descarta en vez de forzarlo.
                if (keyB !== keyA + 1) { sawNonConsecutivePair = true; continue; }

                try {
                    var timeA = prop.keyTime(keyA);
                    var timeB = prop.keyTime(keyB);
                    var timeDelta = timeB - timeA;
                    if (timeDelta <= 0) continue;

                    var valA = prop.keyValue(keyA);
                    var valB = prop.keyValue(keyB);
                    if (!isNumericKeyValue(valA) || !isNumericKeyValue(valB)) continue;

                    var outEase = [];
                    var inEase = [];

                    // Position sin Separate Dimensions es una propiedad
                    // SPATIAL. AE NO espera una ease por eje aquí: espera
                    // UNA sola KeyframeEase que controla el tiempo/velocidad
                    // del movimiento completo. Para obtener la velocidad
                    // correcta usamos la distancia real entre los dos puntos.
                    var isSpatialPosition = (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
                                             prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL);

                    if (isSpatialPosition) {
                        var distanceSq = 0;
                        var spatialDims = (prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) ? 3 : 2;
                        for (var sd = 0; sd < spatialDims; sd++) {
                            var svA = valA[sd];
                            var svB = valB[sd];
                            var sDelta = svB - svA;
                            distanceSq += sDelta * sDelta;
                        }
                        var distance = Math.sqrt(distanceSq);
                        if (distance === 0) distance = 0.0001;

                        var spatialOutConv = bezierControlToAEEase(x1, y1, distance, timeDelta, true);
                        var spatialInConv = bezierControlToAEEase(x2, y2, distance, timeDelta, false);
                        outEase.push(new KeyframeEase(spatialOutConv.speed, spatialOutConv.influence));
                        inEase.push(new KeyframeEase(spatialInConv.speed, spatialInConv.influence));
                    } else {
                        for (var d = 0; d < dims; d++) {
                            var vA = (dims === 1) ? valA : valA[d];
                            var vB = (dims === 1) ? valB : valB[d];
                            var delta = vB - vA;
                            if (delta === 0) delta = 0.0001;

                            var outConv = bezierControlToAEEase(x1, y1, delta, timeDelta, true);
                            var inConv = bezierControlToAEEase(x2, y2, delta, timeDelta, false);

                            outEase.push(new KeyframeEase(outConv.speed, outConv.influence));
                            inEase.push(new KeyframeEase(inConv.speed, inConv.influence));
                        }
                    }

                    pendingOut[keyA] = outEase;
                    pendingIn[keyB] = inEase;
                    if (!touchedSet[keyA]) { touchedSet[keyA] = true; touchedKeys.push(keyA); }
                    if (!touchedSet[keyB]) { touchedSet[keyB] = true; touchedKeys.push(keyB); }
                    segCount++;
                } catch (eSeg) {}
            }

            if (segCount === 0) continue;

            touchedKeys.sort(function (a, b) { return a - b; });

            // ---- PASO 2: capturar la ease YA EXISTENTE de cada keyframe
            // tocado (para el lado que ningún tramo de este Apply
            // recalculó, p.ej. la salida del último keyframe seleccionado)
            // ANTES de tocar su tipo de interpolación, para no perderla.
            var existingIn = {};
            var existingOut = {};
            for (var t = 0; t < touchedKeys.length; t++) {
                var kt = touchedKeys[t];
                try { existingIn[kt] = prop.keyInTemporalEase(kt); } catch (eIn) { existingIn[kt] = null; }
                try { existingOut[kt] = prop.keyOutTemporalEase(kt); } catch (eOut) { existingOut[kt] = null; }
            }

            // ---- PASO 3: fijar Bezier UNA SOLA VEZ por keyframe tocado.
            for (var t2 = 0; t2 < touchedKeys.length; t2++) {
                try {
                    prop.setInterpolationTypeAtKey(touchedKeys[t2], KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                    // Position sin Separate Dimensions es una propiedad espacial.
                    // Desactivar Auto/Continuous temporal evita que AE vuelva a
                    // recalcular la ease inmediatamente después de aplicarla.
                    try { prop.setTemporalAutoBezierAtKey(touchedKeys[t2], false); } catch (eAuto) {}
                    try { prop.setTemporalContinuousAtKey(touchedKeys[t2], false); } catch (eCont) {}
                } catch (eType) {}
            }

            // ---- PASO 4: aplicar la ease final (nueva donde corresponde,
            // conservada donde no) UNA SOLA VEZ por keyframe tocado.
            for (var t3 = 0; t3 < touchedKeys.length; t3++) {
                var k = touchedKeys[t3];
                var finalIn = pendingIn[k] || existingIn[k];
                var finalOut = pendingOut[k] || existingOut[k];
                if (!finalIn || !finalOut) continue;

                // Red de seguridad final: si AE igual rechaza la
                // velocidad calculada (por límites internos propios de
                // esa propiedad puntual), se reintenta reduciéndola a la
                // mitad unas cuantas veces antes de rendirse, en vez de
                // perder el keyframe entero por un solo intento fallido.
                // Solo se reduce el lado que de verdad es nuevo (el
                // conservado no se toca).
                var attemptsLeft = 6;
                while (true) {
                    try {
                        // Para Position (TwoD_SPATIAL/ThreeD_SPATIAL) AE necesita
                        // un KeyframeEase por eje. finalIn/finalOut ya se han
                        // construido con exactamente ese número de dimensiones.
                        // Spatial Position usa UNA sola KeyframeEase.
                        // No se separan X/Y/Z ni se envía una ease por eje.
                        prop.setTemporalEaseAtKey(k, finalIn, finalOut);
                        break;
                    } catch (eEase) {
                        attemptsLeft--;
                        if (attemptsLeft <= 0) break;
                        if (pendingOut[k]) {
                            for (var d2 = 0; d2 < finalOut.length; d2++) {
                                finalOut[d2] = new KeyframeEase(finalOut[d2].speed * 0.5, finalOut[d2].influence);
                            }
                        }
                        if (pendingIn[k]) {
                            for (var d3 = 0; d3 < finalIn.length; d3++) {
                                finalIn[d3] = new KeyframeEase(finalIn[d3].speed * 0.5, finalIn[d3].influence);
                            }
                        }
                    }
                }
            }

            appliedSegments += segCount;
        }

        app.endUndoGroup();
        if (appliedSegments > 0) return "OK:" + appliedSegments;
        if (sawNonConsecutivePair) return "PAIRS_NOT_CONSECUTIVE";
        if (sawSingleKeyOnly) return "NEED_TWO_ADJACENT_KEYFRAMES";
        return "NO_KEYFRAMES_SELECTED";
    } catch (e) {
        app.endUndoGroup();
        return "ERROR:" + e.toString();
    }
}

// --- Aplica un "bounce" (rebote amortiguado) en el tramo ANTES del
//     último keyframe seleccionado de cada propiedad. A diferencia de
//     applyBezierCurveToSelectedKeyframes (que reinterpola el tramo
//     entre dos keyframes SIN añadir ninguno nuevo), esta función SÍ
//     añade nuevos keyframes, pero siempre repartidos entre el
//     penúltimo y el último keyframe seleccionado ("el aterrizaje"),
//     de forma que:
//       - el último keyframe seleccionado (tiempo y valor) NO se toca,
//         y sigue siendo el punto exacto donde termina el movimiento;
//       - los rebotes ocurren ANTES de ese punto, dentro del tramo ya
//         existente, sin añadir tiempo extra después de él;
//       - cada rebote sucesivo es más pequeño y más corto que el
//         anterior (como una pelota perdiendo energía), terminando
//         justo a tiempo para llegar exactamente al aterrizaje.
//
//     bounces: cantidad de rebotes a repartir en ese tramo (entero,
//              típicamente 1-8).
//     decay:   factor 0-1 de amortiguación; cada rebote sucesivo pierde
//              este porcentaje de amplitud y de duración respecto al
//              anterior (más cerca de 1 = rebotes más parejos entre sí;
//              más cerca de 0 = el primer rebote domina casi todo el
//              tramo y los siguientes se apagan casi al instante).
function applyBounceToSelectedKeyframes(bounces, decay) {
    app.beginUndoGroup("Vantyx Flow: apply bounce");
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            app.endUndoGroup();
            return "NO_COMP";
        }
        var comp = app.project.activeItem;

        var props = getPropertiesWithSelectedKeyframes(comp);
        if (props.length === 0) {
            app.endUndoGroup();
            return "NO_KEYFRAMES_SELECTED";
        }

        bounces = Math.round(bounces);
        if (!isFinite(bounces) || bounces < 1) bounces = 1;
        if (bounces > 12) bounces = 12;

        decay = Number(decay);
        if (!isFinite(decay)) decay = 0.5;
        if (decay < 0) decay = 0;
        if (decay > 0.95) decay = 0.95;

        var totalAdded = 0;
        var sawSingleKeyOnly = false;

        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var dims = easeDimensionsForProperty(prop);

            var selKeys = prop.selectedKeys.slice();
            selKeys.sort(function (a, b) { return a - b; });

            if (selKeys.length < 2) { sawSingleKeyOnly = true; continue; }

            // El rebote "aterriza" exactamente en el último keyframe
            // seleccionado (keyD, que no se modifica); el segmento
            // anterior (penúltimo -> último) es el tramo donde se
            // reparten los rebotes, y también da la referencia de
            // valor/tiempo para calcular su tamaño.
            var keyC = selKeys[selKeys.length - 2];
            var keyD = selKeys[selKeys.length - 1];

            try {
                var timeC = prop.keyTime(keyC);
                var timeD = prop.keyTime(keyD);
                var timeDelta = timeD - timeC;
                if (timeDelta <= 0) continue;

                var valC = prop.keyValue(keyC);
                var valD = prop.keyValue(keyD);

                var deltas = [];
                var landing = [];
                for (var d = 0; d < dims; d++) {
                    var vC = (dims === 1) ? valC : valC[d];
                    var vD = (dims === 1) ? valD : valD[d];
                    deltas.push(vD - vC);
                    landing.push(vD);
                }

                // Pesos geométricos decrecientes: reparten timeDelta en
                // "bounces" tramos cada vez más cortos que SUMAN
                // exactamente timeDelta, así el último tramo termina
                // siempre justo en timeD, sin sobrante ni añadir tiempo
                // después del aterrizaje.
                //
                // IMPORTANTE: el peso del primer rebote (w=0) se fija
                // explícitamente en 1 (100%) en vez de depender de
                // Math.pow(decay, 0). Aunque matemáticamente da lo mismo
                // (cualquier valor elevado a 0 es 1), dejarlo explícito
                // garantiza que el primer rebote SIEMPRE tenga la magnitud
                // completa del movimiento original, sin importar el valor
                // de "decay" (incluido decay = 0). Los rebotes siguientes
                // sí dependen de "decay" y van perdiendo fuerza y duración
                // geométricamente respecto a este primero.
                var weights = [];
                var weightSum = 0;
                for (var w = 0; w < bounces; w++) {
                    var wv = (w === 0) ? 1 : Math.pow(decay, w);
                    weights.push(wv);
                    weightSum += wv;
                }

                var t = timeC;
                var addedForThisProp = 0;

                for (var b = 0; b < bounces; b++) {
                    var periodLen = (weights[b] / weightSum) * timeDelta;
                    // Amplitud sin normalizar: el primer rebote (b=0) usa
                    // peso 1 (100% del delta original en sentido contrario,
                    // es decir, vuelve exactamente al valor de keyC — el
                    // "valor contrario" al del último tramo), y los
                    // siguientes van decayendo geométricamente hasta casi
                    // desvanecerse justo antes de llegar a keyD.
                    var ampScale = weights[b];

                    // Pico del rebote: por cada dimensión (eje) de la
                    // propiedad, se calcula de forma independiente usando
                    // el delta real de ESE eje entre keyC y keyD. Restar
                    // "delta * ampScale" al valor de aterrizaje SIEMPRE
                    // produce un pico en el sentido CONTRARIO al del
                    // movimiento original de ese eje:
                    //   - si el eje iba bajando (delta < 0) el pico queda
                    //     por ENCIMA del aterrizaje (sube);
                    //   - si el eje iba subiendo (delta > 0) el pico queda
                    //     por DEBAJO del aterrizaje (baja).
                    // En el primer rebote (ampScale = 1) esto reproduce el
                    // movimiento original completo pero invertido; los
                    // rebotes siguientes repiten el mismo lado (el
                    // contrario), sólo que con magnitud decreciente según
                    // "decay". Al ser por-eje, esto funciona igual para
                    // cualquier propiedad (Position, Rotation, Opacity,
                    // Scale, etc.), no sólo para Scale.
                    var peakTime = t + periodLen * 0.5;
                    var peakValue = (dims === 1)
                        ? (landing[0] - deltas[0] * ampScale)
                        : (function () {
                            var arr = [];
                            for (var d2 = 0; d2 < dims; d2++) arr.push(landing[d2] - deltas[d2] * ampScale);
                            return arr;
                        })();

                    try {
                        prop.setValueAtTime(peakTime, peakValue);
                        addedForThisProp++;
                    } catch (eP) {}

                    t = t + periodLen;

                    // El último tramo ya termina exactamente en timeD
                    // (== keyD): no se crea ahí un keyframe duplicado,
                    // el propio keyD (intacto) hace de aterrizaje final.
                    if (b < bounces - 1) {
                        var touchValue = (dims === 1) ? landing[0] : landing.slice(0, dims);
                        try {
                            prop.setValueAtTime(t, touchValue);
                            addedForThisProp++;
                        } catch (eT) {}
                    }
                }


                // Suaviza (Easy-Ease) todos los keyframes del tramo
                // recién trabajado (entre keyC, exclusive, y keyD,
                // inclusive), para que el rebote no se vea mecánico.
                try {
                    for (var k = 1; k <= prop.numKeys; k++) {
                        var kTime = prop.keyTime(k);
                        if (kTime > timeC + 0.0001 && kTime <= timeD + 0.0001) {
                            prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                            var easeArr = [];
                            for (var dd = 0; dd < dims; dd++) easeArr.push(new KeyframeEase(0, 33));
                            prop.setTemporalEaseAtKey(k, easeArr, easeArr);
                        }
                    }
                } catch (eEase) {}

                totalAdded += addedForThisProp;
            } catch (eSeg) {}
        }

        app.endUndoGroup();
        if (totalAdded > 0) return "OK:" + totalAdded;
        if (sawSingleKeyOnly) return "NEED_TWO_ADJACENT_KEYFRAMES";
        return "NO_KEYFRAMES_SELECTED";
    } catch (e) {
        app.endUndoGroup();
        return "ERROR:" + e.toString();
    }
}

// --- Pone interpolación Lineal pura en los keyframes seleccionados ---
function applyLinearToSelectedKeyframes() {
    app.beginUndoGroup("Vantyx Flow: apply linear");
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            app.endUndoGroup();
            return "NO_COMP";
        }
        var comp = app.project.activeItem;
        var props = getPropertiesWithSelectedKeyframes(comp);
        if (props.length === 0) { app.endUndoGroup(); return "NO_KEYFRAMES_SELECTED"; }

        var count = 0;
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var selKeys = prop.selectedKeys;
            for (var k = 0; k < selKeys.length; k++) {
                try {
                    prop.setInterpolationTypeAtKey(selKeys[k], KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                    count++;
                } catch (eK) {}
            }
        }
        app.endUndoGroup();
        return count > 0 ? ("OK:" + count) : "NO_KEYFRAMES_SELECTED";
    } catch (e) {
        app.endUndoGroup();
        return "ERROR:" + e.toString();
    }
}

// --- Lee la curva ya existente entre los DOS PRIMEROS keyframes
//     seleccionados (deben ser consecutivos, en la misma propiedad) y
//     la convierte en (x1,y1,x2,y2) para poder seguir editándola en el
//     panel. No modifica nada en el proyecto: es de solo lectura. ---
function readCurveFromSelectedKeyframes() {
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            return "NO_COMP";
        }
        var comp = app.project.activeItem;
        var props = getPropertiesWithSelectedKeyframes(comp);
        if (props.length === 0) return "NO_KEYFRAMES_SELECTED";

        var prop = null, selKeys = null;
        for (var i = 0; i < props.length; i++) {
            var candidateKeys = props[i].selectedKeys.slice();
            if (candidateKeys.length >= 2) {
                prop = props[i];
                selKeys = candidateKeys;
                break;
            }
        }
        if (!prop) return "NEED_TWO_ADJACENT_KEYFRAMES";

        selKeys.sort(function (a, b) { return a - b; });
        var keyA = selKeys[0];
        var keyB = selKeys[1];

        var timeA = prop.keyTime(keyA);
        var timeB = prop.keyTime(keyB);
        var timeDelta = timeB - timeA;
        if (timeDelta <= 0) return "ERROR:INVALID_TIME_RANGE";

        var outType = prop.keyOutInterpolationType(keyA);
        var inType = prop.keyInInterpolationType(keyB);

        if (outType === KeyframeInterpolationType.HOLD || inType === KeyframeInterpolationType.HOLD) {
            return "HOLD_NOT_SUPPORTED";
        }

        if (outType === KeyframeInterpolationType.LINEAR && inType === KeyframeInterpolationType.LINEAR) {
            return "OK:0,0,1,1";
        }

        var dims = easeDimensionsForProperty(prop);
        var valA = prop.keyValue(keyA);
        var valB = prop.keyValue(keyB);
        var vA0 = (dims === 1) ? valA : valA[0];
        var vB0 = (dims === 1) ? valB : valB[0];
        var delta = vB0 - vA0;
        if (delta === 0) delta = 0.0001;

        // keyOutTemporalEase / keyInTemporalEase devuelven un array de
        // KeyframeEase (uno por dimensión). Usamos la primera dimensión
        // como referencia representativa de la curva.
        var outEaseArr = prop.keyOutTemporalEase(keyA);
        var inEaseArr = prop.keyInTemporalEase(keyB);
        var outEase = outEaseArr[0];
        var inEase = inEaseArr[0];

        var p1 = aeEaseToBezierControl(outEase.influence, outEase.speed, delta, timeDelta, true);
        var p2 = aeEaseToBezierControl(inEase.influence, inEase.speed, delta, timeDelta, false);

        return "OK:" + p1.x + "," + p1.y + "," + p2.x + "," + p2.y;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

// --- Exporta la biblioteca (recibida ya como texto JSON codificado con
//     encodeURIComponent, para que viaje intacto por evalScript sin
//     problemas de comillas/saltos de línea) preguntando SIEMPRE la
//     ubicación mediante el diálogo nativo "Guardar como" del sistema. ---
function exportLibraryToFile(encodedJson) {
    try {
        var file = File.saveDialog("Save Flow Library", "Flow Library:*.flow");
        if (!file) return "CANCELLED";

        var path = file.fsName;
        if (!/\.flow$/i.test(path)) path = path + ".flow";

        var text = decodeURIComponent(encodedJson);

        var out = new File(path);
        out.encoding = "UTF-8";
        if (!out.open("w")) return "ERROR:COULD_NOT_OPEN_FILE";
        out.write(text);
        out.close();

        return "OK:" + encodeURIComponent(path);
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

// --- Importa una biblioteca preguntando SIEMPRE la ubicación mediante el
//     diálogo nativo "Abrir" del sistema. Devuelve la ruta y el contenido
//     del archivo, ambos codificados con encodeURIComponent, separados
//     por "|||", para que el panel los pueda parsear sin ambigüedad. ---
function importLibraryFromFile() {
    try {
        var file = File.openDialog("Select a Flow Library file", "Flow Library:*.flow;All files:*.*");
        if (!file) return "CANCELLED";

        var path = file.fsName;
        file.encoding = "UTF-8";
        if (!file.open("r")) return "ERROR:COULD_NOT_OPEN_FILE";
        var text = file.read();
        file.close();

        return "OK:" + encodeURIComponent(path) + "|||" + encodeURIComponent(text);
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}
