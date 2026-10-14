var _vantyxLastRenderError = "";
var _vantyxLastDecodeError = "";
var VANTYX_JSX_BUILD = "build 2026-08-25-u"; // debe coincidir con BUILD_TAG de vtx-main.js

// Límites de seguridad para el inflate manual: sin esto, un PNG grande o un
// caso límite del decodificador puede colgar/crashear AE sin forma de
// interrumpirlo desde fuera. Con esto, aborta de forma controlada.
var MAX_INFLATE_MS = 8000;        // no más de 8s descomprimiendo
var MAX_INFLATE_BYTES = 1200000;  // ~1.2MB de píxeles crudos como tope (de sobra para ~160px)
var _vantyxInflateStartTime = 0;

function inflateBudgetExceeded(out) {
    if (out.length >= MAX_INFLATE_BYTES) return true;
    if ((new Date().getTime() - _vantyxInflateStartTime) > MAX_INFLATE_MS) return true;
    return false;
}

function toHex(val) {
    var hex = Math.round(val).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
    return "#" + toHex(r * 255) + toHex(g * 255) + toHex(b * 255);
}

function getLayerColor(layer) {
    if (!layer) return null;

    // 1. Capas de Texto
    try {
        if (layer.property("Source Text") !== null) {
            var textDoc = layer.property("Source Text").value;
            if (textDoc && textDoc.applyFill) {
                var c = textDoc.fillColor;
                return rgbToHex(c[0], c[1], c[2]);
            }
        }
    } catch (e1) {}

    // 2. Capas de Forma (Shape Layers)
    try {
        var contents = layer.property("Contents");
        if (contents !== null) {
            for (var i = 1; i <= contents.numProperties; i++) {
                var group = contents.property(i);
                if (group && group.property("Contents")) {
                    var fill = group.property("Contents").property("Fill 1");
                    if (fill && fill.property("Color")) {
                        var fc = fill.property("Color").value;
                        return rgbToHex(fc[0], fc[1], fc[2]);
                    }
                }
            }
        }
    } catch (e2) {}

    // 3. Capas Sólidas
    try {
        if (layer.mainSource && layer.mainSource.color) {
            var sc = layer.mainSource.color;
            return rgbToHex(sc[0], sc[1], sc[2]);
        }
    } catch (e3) {}

    // 4. Imágenes o Vídeo (Muestra del centro de la capa) - fallback rápido
    try {
        if (typeof layer.sampleImage === "function") {
            var w = layer.width || 100;
            var h = layer.height || 100;
            var sample = layer.sampleImage([w / 2, h / 2], [1, 1]);
            if (sample) {
                return rgbToHex(sample[0], sample[1], sample[2]);
            }
        }
    } catch (e4) {}

    return null;
}

// ---------------------------------------------------------------------
// "From selection": color real del centro de la capa seleccionada,
// usando el mismo render-a-PNG-real que pullColorsFromSelectedLayers.
// Nunca devuelve un color inventado: si no puede samplear, avisa.
// ---------------------------------------------------------------------
function getSelectedLayerRealColor() {
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            return "NO_SELECTION";
        }
        var comp = app.project.activeItem;
        if (!comp.selectedLayers || comp.selectedLayers.length === 0) return "NO_SELECTION";
        var layer = comp.selectedLayers[0];

        var colors = [];
        if (layer instanceof AVLayer) {
            // Muestreo directo primero (sampleImage): sin crear comps ni
            // renderizar a PNG, prácticamente instantáneo. El render real
            // solo se usa como respaldo si esto no da ningún color (casos
            // raros: ciertos precomps/efectos/mattes de seguimiento).
            colors = sampleLayerGrid(layer, comp, 3, 3);
            if (colors.length === 0) colors = renderLayerFrameColors(layer, comp, 3, 3);
        }
        if (colors.length > 0) return colors[Math.floor(colors.length / 2)];

        var single = getLayerColor(layer);
        if (single) return single;

        if (_vantyxLastRenderError) return "ERROR:" + _vantyxLastRenderError;
        return "NO_COLOR";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

function getSelectedLayerColor() {
    try {
        if (app.project && app.project.activeItem && app.project.activeItem.selectedLayers) {
            var sel = app.project.activeItem.selectedLayers;
            if (sel.length > 0) {
                var color = getLayerColor(sel[0]);
                if (color) return color;
            }
        }
    } catch (e) {}
    return "ERR_NO_COLOR";
}

// =======================================================================
// FUENTES: capturar de la capa de texto seleccionada y aplicar a otra.
// =======================================================================

// --- Lee la fuente de la primera capa de texto seleccionada ---
function getSelectedTextLayerFont() {
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            return "NO_SELECTION";
        }
        var comp = app.project.activeItem;
        if (!comp.selectedLayers || comp.selectedLayers.length === 0) return "NO_SELECTION";

        var layer = null;
        for (var i = 0; i < comp.selectedLayers.length; i++) {
            var candidate = comp.selectedLayers[i];
            if (candidate.property("Source Text") !== null) { layer = candidate; break; }
        }
        if (!layer) return "NOT_TEXT_LAYER";

        var doc = layer.property("Source Text").value;
        var result = {
            font: doc.font,                                  // nombre PostScript, el que se usa para aplicar
            fontFamily: doc.fontFamily ? doc.fontFamily : doc.font,
            fontStyle: doc.fontStyle ? doc.fontStyle : ""
        };
        return JSON.stringify(result);
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

// --- Aplica una fuente (por nombre PostScript) a las capas de texto seleccionadas ---
function applyFontToSelectedTextLayers(postscriptName) {
    var applied = false;
    app.beginUndoGroup("Vantyx: apply font");
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            return "NO_SELECTION";
        }
        var comp = app.project.activeItem;
        if (!comp.selectedLayers || comp.selectedLayers.length === 0) return "NO_SELECTION";

        for (var i = 0; i < comp.selectedLayers.length; i++) {
            var layer = comp.selectedLayers[i];
            var textProp = layer.property("Source Text");
            if (!textProp) continue;
            try {
                var doc = textProp.value;
                doc.font = postscriptName;
                textProp.setValue(doc);
                applied = true;
            } catch (eOne) {}
        }
    } catch (e) {
        app.endUndoGroup();
        return "ERROR:" + e.toString();
    }
    app.endUndoGroup();
    return applied ? "true" : "NOT_TEXT_LAYER";
}

// =======================================================================
// LOGO / MEDIA: importar imágenes y vídeos, generar miniatura real y
// colocarlos en el comp activo.
// =======================================================================

// Carpeta persistente para miniaturas generadas (vídeos). Las imágenes fijas
// usan directamente su propio archivo, no generan copia.
function vantyxThumbFolder() {
    var f = new Folder(Folder.userData.fsName + "/VantyxStudio/thumbnails");
    if (!f.exists) f.create();
    return f;
}

// Renderiza un frame representativo (mitad de duración, o único frame si es
// estático) a un PNG pequeño y persistente, para usar como miniatura.
function generateThumbnailForItem(item) {
    var TARGET_MAX_DIM = 160;
    var tempComp = null;
    var tempLayer = null;
    var thumbFile = new File(vantyxThumbFolder().fsName + "/thumb_" + item.id + "_" +
        Math.round(Math.random() * 1e6) + ".png");

    app.beginUndoGroup("Vantyx: generate thumbnail");
    try {
        var srcW = item.width || TARGET_MAX_DIM;
        var srcH = item.height || TARGET_MAX_DIM;
        var longSide = Math.max(srcW, srcH);
        var scale = Math.min(1, TARGET_MAX_DIM / longSide);
        var tempW = Math.max(2, Math.round(srcW * scale));
        var tempH = Math.max(2, Math.round(srcH * scale));

        tempComp = app.project.items.addComp("__vantyx_thumb__", tempW, tempH, 1, 1, 30);
        tempLayer = tempComp.layers.add(item);
        tempLayer.property("Transform").property("Scale").setValue([scale * 100, scale * 100]);

        var midTime = 0;
        try { if (item.duration && item.duration > 0) midTime = item.duration / 2; } catch (eDur) {}
        tempLayer.startTime = -midTime; // que el frame central del footage caiga en t=0 del temp comp

        var pngResult = tempComp.saveFrameToPng(0, thumbFile);
        var waited = 0;
        if (pngResult && typeof pngResult._isReady !== "undefined") {
            while (!pngResult._isReady && waited < 5000) { $.sleep(100); waited += 100; }
        } else {
            while ((!thumbFile.exists || thumbFile.length === 0) && waited < 5000) { $.sleep(100); waited += 100; }
        }

        if (!thumbFile.exists || thumbFile.length === 0) return "";
        return thumbFile.fsName;
    } catch (e) {
        return "";
    } finally {
        if (tempLayer) { try { tempLayer.remove(); } catch (e1) {} }
        if (tempComp) { try { tempComp.remove(); } catch (e2) {} }
        app.endUndoGroup();
    }
}

// --- Diálogo nativo para elegir imágenes/vídeos, los importa al proyecto
//     y genera una miniatura (real para vídeos, directa para imágenes fijas) ---
function importMediaFile() {
    try {
        var filter = "Media files:*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.tif;*.tiff;*.psd;*.mp4;*.mov;*.avi;*.mkv;*.webm";
        var files = File.openDialog("Selecciona imágenes o vídeos", filter, true);
        if (!files || files.length === 0) return "CANCELLED";

        var results = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            try {
                var io = new ImportOptions(f);
                var item = app.project.importFile(io);

                var isStill = false;
                try { isStill = !!(item.mainSource && item.mainSource.isStill); } catch (eStill) {}

                var thumbPath = "";
                if (isStill && item.mainSource && item.mainSource.file) {
                    thumbPath = item.mainSource.file.fsName; // imagen fija: usa el archivo original
                } else {
                    thumbPath = generateThumbnailForItem(item); // vídeo: frame real renderizado
                }

                results.push({ id: item.id, name: item.name, thumb: thumbPath, file: f.fsName });
            } catch (eImp) {
                // archivo no soportado o falló la importación: se omite
            }
        }
        if (results.length === 0) return "NO_VALID_FILES";
        return JSON.stringify(results);
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

// --- Inserta un item del proyecto (por id) como capa nueva en el comp activo ---
// --- Inserta un item del proyecto (por id) en el comp activo. Si el item ya
//     no está en el proyecto, lo reimporta automáticamente desde su ruta
//     original antes de añadirlo, sin que el usuario tenga que hacer nada. ---
function insertMediaByIdOrPath(itemId, filePath) {
    app.beginUndoGroup("Vantyx: add media to comp");
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            app.endUndoGroup();
            return "NO_COMP";
        }
        var comp = app.project.activeItem;

        var item = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === itemId) { item = app.project.item(i); break; }
        }

        var reimported = false;
        if (!item && filePath) {
            try {
                var f = new File(filePath);
                if (f.exists) {
                    var io = new ImportOptions(f);
                    item = app.project.importFile(io);
                    reimported = true;
                }
            } catch (eReimport) {}
        }

        if (!item) { app.endUndoGroup(); return "ITEM_NOT_FOUND"; }

        var newLayer = comp.layers.add(item);
        newLayer.startTime = comp.time; // aparece a partir del playhead actual
        app.endUndoGroup();
        return JSON.stringify({ ok: true, newId: item.id, reimported: reimported });
    } catch (e) {
        app.endUndoGroup();
        return "ERROR:" + e.toString();
    }
}

// ---------------------------------------------------------------------
// Distancia euclídea simple entre dos colores HEX (0-441 aprox.)
// ---------------------------------------------------------------------
function hexToRgbArr(hex) {
    hex = hex.replace("#", "");
    return [
        parseInt(hex.substring(0, 2), 16),
        parseInt(hex.substring(2, 4), 16),
        parseInt(hex.substring(4, 6), 16)
    ];
}

function colorDistance(hexA, hexB) {
    var a = hexToRgbArr(hexA);
    var b = hexToRgbArr(hexB);
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Añade hex a la lista solo si no hay ya un color "suficientemente parecido"
// (tolerance en distancia RGB; ~0 = solo idénticos, ~30-40 = tonos similares fusionados)
function addColorWithTolerance(list, hex, tolerance) {
    for (var i = 0; i < list.length; i++) {
        if (colorDistance(list[i], hex) <= tolerance) return false;
    }
    list.push(hex);
    return true;
}

// =======================================================================
// DECODIFICADOR PNG MANUAL (puro ExtendScript, sin dependencias externas)
// Implementa: lectura binaria, parseo de chunks, inflate DEFLATE (RFC1951)
// y des-filtrado de scanlines (None/Sub/Up/Average/Paeth, RFC2083 §6).
// =======================================================================

// --- Lectura binaria de fichero -> array de bytes (0-255) ---
function readBinaryFileBytes(fileObj) {
    fileObj.encoding = "BINARY";
    if (!fileObj.open("r")) return null;
    var data = fileObj.read();
    fileObj.close();
    var bytes = [];
    bytes.length = data.length;
    for (var i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
    }
    return bytes;
}

function readUInt32BE(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

// --- Parseo de chunks PNG: firma, IHDR, concatenación de IDAT ---
function parsePNGChunks(bytes) {
    var sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (var s = 0; s < 8; s++) {
        if (bytes[s] !== sig[s]) return null; // no es un PNG válido
    }
    var offset = 8;
    var width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    var idat = [];
    while (offset + 8 <= bytes.length) {
        var len = readUInt32BE(bytes, offset); offset += 4;
        var type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        offset += 4;
        if (type === "IHDR") {
            width = readUInt32BE(bytes, offset);
            height = readUInt32BE(bytes, offset + 4);
            bitDepth = bytes[offset + 8];
            colorType = bytes[offset + 9];
            interlace = bytes[offset + 12];
        } else if (type === "IDAT") {
            idat = idat.concat(bytes.slice(offset, offset + len));
        } else if (type === "IEND") {
            break;
        }
        offset += len + 4; // datos + CRC
    }
    if (interlace !== 0) return null; // Adam7 no soportado
    return { width: width, height: height, bitDepth: bitDepth, colorType: colorType, idat: idat };
}

// --- Inflate zlib (2 bytes cabecera + deflate + 4 bytes Adler32) ---
function zlibInflate(compressed) {
    var raw = compressed.slice(2, compressed.length - 4);
    return inflateRaw(raw);
}

// --- Lector de bits LSB-first sobre un array de bytes ---
function InflateBitReader(data) {
    this.data = data;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
    this.truncated = false; // true si se intenta leer más allá del stream
}
InflateBitReader.prototype.getBit = function () {
    if (this.bitCount === 0) {
        if (this.pos >= this.data.length) {
            // Sin esto, leer más allá del final devolvía ceros para siempre
            // y esos ceros podían decodificar como un símbolo Huffman válido
            // en bucle infinito, reventando la memoria.
            this.truncated = true;
            this.bitBuf = 0;
        } else {
            this.bitBuf = this.data[this.pos++];
        }
        this.bitCount = 8;
    }
    var bit = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCount--;
    return bit;
};
InflateBitReader.prototype.getBits = function (n) {
    // Antes: llamaba a getBit() n veces (n llamadas a función + ramas).
    // Ahora: rellena el buffer de bits con bytes completos y extrae los
    // n bits de una vez. Mismo orden de bits (LSB-first) y mismo
    // comportamiento de truncado, solo con menos overhead por llamada.
    if (n === 0) return 0;
    while (this.bitCount < n) {
        if (this.pos >= this.data.length) {
            this.truncated = true;
            this.bitCount = n; // rellena con "ceros" el resto que falta
            break;
        }
        this.bitBuf |= (this.data[this.pos++] << this.bitCount);
        this.bitCount += 8;
    }
    var value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return value;
};
InflateBitReader.prototype.alignByte = function () {
    this.bitBuf = 0;
    this.bitCount = 0;
};

// --- Construcción de árbol Huffman canónico (estilo puff.c de M. Adler) ---
function constructHuffman(lengths) {
    var MAXBITS = 15;
    var count = [];
    for (var i = 0; i <= MAXBITS; i++) count[i] = 0;
    for (i = 0; i < lengths.length; i++) count[lengths[i]]++;
    count[0] = 0;
    var offs = [];
    offs[1] = 0;
    for (var len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + count[len];
    var symbols = [];
    for (i = 0; i < lengths.length; i++) {
        if (lengths[i] !== 0) symbols[offs[lengths[i]]++] = i;
    }
    return { count: count, symbols: symbols };
}

function decodeSymbol(br, huff) {
    // Función más caliente de todo el decodificador (se llama una vez por
    // cada símbolo literal/longitud del stream). Antes hacía br.getBit()
    // en cada iteración (llamada a método + accesos a propiedades de br
    // en cada bit). Ahora se copian bitBuf/bitCount/pos a variables locales,
    // se opera sobre ellas directamente, y solo se escriben de vuelta en
    // br una vez al final. Mismo algoritmo y mismo resultado, menos overhead.
    var code = 0, first = 0, index = 0;
    var bitBuf = br.bitBuf, bitCount = br.bitCount;
    var data = br.data, pos = br.pos, dataLen = data.length;
    var count = huff.count, symbols = huff.symbols;

    for (var len = 1; len <= 15; len++) {
        if (bitCount === 0) {
            if (pos >= dataLen) {
                br.truncated = true;
                bitBuf = 0;
            } else {
                bitBuf = data[pos++];
            }
            bitCount = 8;
        }
        code |= (bitBuf & 1);
        bitBuf >>= 1;
        bitCount--;

        var cnt = count[len];
        if (code - first < cnt) {
            br.bitBuf = bitBuf;
            br.bitCount = bitCount;
            br.pos = pos;
            return symbols[index + (code - first)];
        }
        index += cnt;
        first += cnt;
        first <<= 1;
        code <<= 1;
    }
    br.bitBuf = bitBuf;
    br.bitCount = bitCount;
    br.pos = pos;
    return -1;
}

var DEFLATE_LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var DEFLATE_LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var DEFLATE_DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var DEFLATE_DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var DEFLATE_CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function fixedHuffmanTables() {
    var lengths = [];
    var i;
    for (i = 0; i < 144; i++) lengths[i] = 8;
    for (i = 144; i < 256; i++) lengths[i] = 9;
    for (i = 256; i < 280; i++) lengths[i] = 7;
    for (i = 280; i < 288; i++) lengths[i] = 8;
    var distLengths = [];
    for (i = 0; i < 30; i++) distLengths[i] = 5;
    return { lenHuff: constructHuffman(lengths), distHuff: constructHuffman(distLengths) };
}

function dynamicHuffmanTables(br) {
    var hlit = br.getBits(5) + 257;
    var hdist = br.getBits(5) + 1;
    var hclen = br.getBits(4) + 4;

    var clLengths = [];
    for (var i = 0; i < 19; i++) clLengths[i] = 0;
    for (i = 0; i < hclen; i++) clLengths[DEFLATE_CLORDER[i]] = br.getBits(3);
    var clHuff = constructHuffman(clLengths);

    var lengths = [];
    var n = 0;
    while (n < hlit + hdist) {
        var sym = decodeSymbol(br, clHuff);
        if (sym < 0) return null;
        if (sym < 16) {
            lengths[n++] = sym;
        } else if (sym === 16) {
            var prev = lengths[n - 1];
            var rep = br.getBits(2) + 3;
            while (rep-- > 0) lengths[n++] = prev;
        } else if (sym === 17) {
            var rep2 = br.getBits(3) + 3;
            while (rep2-- > 0) lengths[n++] = 0;
        } else if (sym === 18) {
            var rep3 = br.getBits(7) + 11;
            while (rep3-- > 0) lengths[n++] = 0;
        } else {
            return null;
        }
    }
    var litLengths = lengths.slice(0, hlit);
    var distLengths = lengths.slice(hlit, hlit + hdist);
    return { lenHuff: constructHuffman(litLengths), distHuff: constructHuffman(distLengths) };
}

var INFLATE_MAX_OUTPUT_BYTES = MAX_INFLATE_BYTES; // unificado con el límite global de arriba

function inflateStoredBlock(br, out) {
    br.alignByte();
    if (br.pos + 4 > br.data.length) { br.truncated = true; return; }
    var len = br.data[br.pos] | (br.data[br.pos + 1] << 8);
    br.pos += 4; // LEN + NLEN (complemento, se ignora)
    for (var i = 0; i < len; i++) {
        if (br.truncated || inflateBudgetExceeded(out)) { br.truncated = true; return; }
        out.push(br.data[br.pos++]);
    }
}

function inflateCompressedBlock(br, out, lenHuff, distHuff) {
    var checkCounter = 0;
    for (;;) {
        checkCounter++;
        if ((checkCounter & 511) === 0 && inflateBudgetExceeded(out)) return false; // no comprobar en cada símbolo: coste de Date()
        if (br.truncated) return false;
        var sym = decodeSymbol(br, lenHuff);
        if (sym < 0) return false;
        if (sym < 256) {
            out.push(sym);
        } else if (sym === 256) {
            return true; // fin de bloque
        } else {
            sym -= 257;
            if (sym >= DEFLATE_LBASE.length) return false;
            var length = DEFLATE_LBASE[sym] + br.getBits(DEFLATE_LEXT[sym]);
            var dsym = decodeSymbol(br, distHuff);
            if (dsym < 0 || dsym >= DEFLATE_DBASE.length) return false;
            var dist = DEFLATE_DBASE[dsym] + br.getBits(DEFLATE_DEXT[dsym]);
            var srcPos = out.length - dist;
            if (srcPos < 0) return false;
            if (out.length + length > MAX_INFLATE_BYTES) return false;
            for (var c = 0; c < length; c++) out.push(out[srcPos + c]);
        }
    }
}

// --- Descompresor DEFLATE puro (RFC1951) ---
function inflateRaw(data) {
    _vantyxInflateStartTime = new Date().getTime();
    var br = new InflateBitReader(data);
    var out = [];
    var isFinalBlock;
    do {
        if (inflateBudgetExceeded(out)) { _vantyxLastDecodeError = "INFLATE_TIMEOUT_OR_TOO_LARGE"; return out; }
        isFinalBlock = br.getBit();
        var type = br.getBits(2);
        if (type === 0) {
            inflateStoredBlock(br, out);
        } else if (type === 1 || type === 2) {
            var tables = (type === 1) ? fixedHuffmanTables() : dynamicHuffmanTables(br);
            if (!tables) return out;
            if (!inflateCompressedBlock(br, out, tables.lenHuff, tables.distHuff)) return out;
        } else {
            return out; // tipo de bloque inválido
        }
    } while (!isFinalBlock);
    return out;
}

// --- Predictor Paeth (RFC2083 §6.6) ---
function paethPredictor(a, b, c) {
    // Mismo cálculo que antes, pero sin las 3 llamadas a Math.abs() por
    // byte (esta función se invoca una vez por cada canal de cada píxel
    // en las filas con filtro Paeth), sustituidas por una comprobación
    // de signo directa.
    var p = a + b - c;
    var pa = p - a; if (pa < 0) pa = -pa;
    var pb = p - b; if (pb < 0) pb = -pb;
    var pc = p - c; if (pc < 0) pc = -pc;
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

// --- Reconstrucción de scanlines filtradas -> buffer de píxeles crudo ---
function unfilterPNG(raw, width, height, bpp) {
    var stride = width * bpp;
    var out = [];
    out.length = height * stride;
    var rawPos = 0;
    for (var y = 0; y < height; y++) {
        var filterType = raw[rawPos++];
        var rowStart = y * stride;
        var prevRowStart = (y - 1) * stride;
        for (var x = 0; x < stride; x++) {
            var filt = raw[rawPos++];
            var a = x >= bpp ? out[rowStart + x - bpp] : 0;
            var b = y > 0 ? out[prevRowStart + x] : 0;
            var c = (y > 0 && x >= bpp) ? out[prevRowStart + x - bpp] : 0;
            var val;
            switch (filterType) {
                case 0: val = filt; break;
                case 1: val = filt + a; break;
                case 2: val = filt + b; break;
                case 3: val = filt + ((a + b) >> 1); break; // equivalente exacto a Math.floor((a+b)/2) para enteros >= 0
                case 4: val = filt + paethPredictor(a, b, c); break;
                default: val = filt;
            }
            out[rowStart + x] = val & 0xff;
        }
    }
    return out;
}

// --- Decodifica un fichero PNG completo a { width, height, channels, pixels } ---
function decodePNGFile(fileObj) {
    _vantyxLastDecodeError = "";

    var bytes = readBinaryFileBytes(fileObj);
    if (!bytes || bytes.length < 8) { _vantyxLastDecodeError = "READ_FAILED"; return null; }

    var meta = parsePNGChunks(bytes);
    if (!meta) { _vantyxLastDecodeError = "CHUNK_PARSE_FAILED_OR_INTERLACED"; return null; }
    if (meta.idat.length === 0) { _vantyxLastDecodeError = "NO_IDAT_DATA"; return null; }

    if (meta.bitDepth !== 8 && meta.bitDepth !== 16) {
        _vantyxLastDecodeError = "UNSUPPORTED_BITDEPTH:" + meta.bitDepth;
        return null;
    }

    var channels;
    switch (meta.colorType) {
        case 0: channels = 1; break; // grayscale
        case 2: channels = 3; break; // RGB
        case 4: channels = 2; break; // grayscale + alpha
        case 6: channels = 4; break; // RGBA
        default:
            _vantyxLastDecodeError = "UNSUPPORTED_COLORTYPE:" + meta.colorType; // paleta indexada, etc.
            return null;
    }

    var bytesPerSample = meta.bitDepth / 8; // 1 (8 bits) o 2 (16 bits/canal)
    var bpp = channels * bytesPerSample;    // bytes por píxel, para el des-filtrado

    var rawDeflated = zlibInflate(meta.idat);
    if (!rawDeflated || rawDeflated.length === 0) { _vantyxLastDecodeError = "INFLATE_EMPTY"; return null; }

    var expectedBytes = meta.height * (1 + meta.width * bpp); // +1 byte de filtro por fila
    if (rawDeflated.length < expectedBytes) {
        // Datos incompletos (p.ej. abortado por el límite de tiempo/tamaño):
        // mejor fallar limpio que generar colores basura con NaN.
        _vantyxLastDecodeError = (_vantyxLastDecodeError || "INFLATE_INCOMPLETE") +
            " (got=" + rawDeflated.length + "b, need=" + expectedBytes + "b)";
        return null;
    }

    var pixels = unfilterPNG(rawDeflated, meta.width, meta.height, bpp);

    return {
        width: meta.width,
        height: meta.height,
        channels: channels,
        bitDepth: meta.bitDepth,
        bytesPerSample: bytesPerSample,
        pixels: pixels
    };
}

// --- Muestrea el buffer de píxeles decodificado en cuadrícula ---
function sampleDecodedPngGrid(png, cols, rows) {
    var found = [];
    if (!png || png.width < 1 || png.height < 1) return found;

    var stepX = png.width / (cols + 1);
    var stepY = png.height / (rows + 1);
    var bps = png.bytesPerSample || 1;      // 1 = 8 bits, 2 = 16 bits/canal
    var pixStride = png.channels * bps;

    for (var cx = 1; cx <= cols; cx++) {
        for (var cy = 1; cy <= rows; cy++) {
            var px = Math.min(png.width - 1, Math.floor(stepX * cx));
            var py = Math.min(png.height - 1, Math.floor(stepY * cy));
            var base = (py * png.width + px) * pixStride;

            // Para 16 bits/canal, PNG guarda cada muestra en big-endian:
            // el primer byte es el más significativo, suficiente para el color.
            var r = png.pixels[base];
            var g = png.channels >= 3 ? png.pixels[base + bps] : r;
            var b = png.channels >= 3 ? png.pixels[base + bps * 2] : r;
            var a = 255;
            if (png.channels === 2) a = png.pixels[base + bps];
            else if (png.channels === 4) a = png.pixels[base + bps * 3];

            if (a > 12) { // descarta solo transparente, nunca por ser negro
                found.push(rgbToHex(r / 255, g / 255, b / 255));
            }
        }
    }
    return found;
}

// =======================================================================
// RENDER DE FRAME REAL: solea la capa, exporta el frame actual a un PNG
// temporal con saveFrameToPng(), lo decodifica a mano y muestrea colores.
// =======================================================================
// Pone el flag "solo" de forma segura: AE lanza error al tocar "solo" en
// una capa deshabilitada (incluso para ponerlo a false), así que lo ignoramos.
function trySetSolo(layerObj, value) {
    try { layerObj.solo = value; } catch (eSolo) { /* capa deshabilitada, no importa */ }
}

function renderLayerFrameColors(layer, comp, cols, rows) {
    // Wrapper de compatibilidad para un caso de una sola capa: usa el mismo
    // motor en lote de abajo con un array de 1 elemento. Mismo resultado
    // exacto que antes, misma ruta de render/decode.
    var batch = renderLayersFrameColorsBatch([layer], comp, cols, rows);
    _vantyxLastRenderError = (batch.errors && batch.errors[0]) ? batch.errors[0] : "";
    return (batch.colors && batch.colors[0]) ? batch.colors[0] : [];
}

// ---------------------------------------------------------------------
// Igual que renderLayerFrameColors, pero para VARIAS capas a la vez:
// crea UN único comp temporal y anida el comp original UNA sola vez
// (en vez de crear/destruir un comp por cada capa), y entre una capa y
// la siguiente solo alterna el flag "solo" (apaga la anterior, enciende
// la actual) en vez de recorrer todas las capas del comp cada vez.
// El render real y el decodificado de cada frame son EXACTAMENTE los
// mismos que antes; lo único que se comparte es la infraestructura del
// comp temporal, así que el color resultante no cambia.
// Devuelve { colors: [ [hex,...], ... ], errors: ["", ...] } paralelo
// al array "avLayers" de entrada.
// ---------------------------------------------------------------------
function renderLayersFrameColorsBatch(avLayers, comp, cols, rows) {
    var resultsByLayer = [];
    var errorsByLayer = [];
    var n = avLayers ? avLayers.length : 0;
    for (var r = 0; r < n; r++) { resultsByLayer[r] = []; errorsByLayer[r] = ""; }

    if (typeof comp.saveFrameToPng !== "function") {
        _vantyxLastRenderError = "NO_SAVEFRAMETOPNG_SUPPORT";
        for (var r2 = 0; r2 < n; r2++) errorsByLayer[r2] = _vantyxLastRenderError;
        return { colors: resultsByLayer, errors: errorsByLayer };
    }
    if (n === 0) return { colors: resultsByLayer, errors: errorsByLayer };

    var tempFile = null;
    var tempComp = null;
    var tempCompLayer = null;
    var prevSolo = [];
    var prevEnabledByIndex = [];
    var i;

    app.beginUndoGroup("Vantyx: sample layer colors");
    try {
        tempFile = new File(Folder.temp.fsName + "/vantyx_frame_" + Math.round(Math.random() * 1e9) + ".png");

        // Captura y apaga el "solo" de todas las capas del comp UNA sola vez
        // para todo el lote (antes se repetía por cada capa procesada).
        for (i = 1; i <= comp.numLayers; i++) prevSolo.push(comp.layer(i).solo);
        for (i = 1; i <= comp.numLayers; i++) trySetSolo(comp.layer(i), false);

        // comp.resolutionFactor NO afecta a saveFrameToPng() (solo al visor
        // interactivo), así que la única forma fiable de que el PNG nazca
        // pequeño es anidar el comp original (ya soleado) dentro de un comp
        // temporal diminuto, escalado, y exportar el frame de ESE comp.
        var TARGET_MAX_DIM = 120; // de sobra para una cuadrícula de muestreo de color
        var longSide = Math.max(comp.width, comp.height);
        var scale = Math.min(1, TARGET_MAX_DIM / longSide);
        var tempW = Math.max(2, Math.round(comp.width * scale));
        var tempH = Math.max(2, Math.round(comp.height * scale));

        // Un único comp temporal y una única capa anidada (el comp original
        // completo) para TODO el lote, en vez de uno por cada capa.
        tempComp = app.project.items.addComp("__vantyx_sample__", tempW, tempH, comp.pixelAspect, 1, comp.frameRate);
        tempCompLayer = tempComp.layers.add(comp);
        tempCompLayer.startTime = -comp.time; // que el frame 0 del temp comp = comp.time del original
        tempCompLayer.property("Transform").property("Scale").setValue([scale * 100, scale * 100]);

        var currentlySoloed = null;

        for (var li = 0; li < n; li++) {
            var layer = avLayers[li];
            try {
                prevEnabledByIndex[li] = layer.enabled;
                if (!layer.enabled) layer.enabled = true; // solo exige que la capa esté activa

                // Solo hay que tocar dos capas: apagar la que estaba soleada
                // y encender la actual (nada de recorrer todo el comp otra vez).
                if (currentlySoloed) trySetSolo(currentlySoloed, false);
                trySetSolo(layer, true);
                currentlySoloed = layer;

                var pngResult = tempComp.saveFrameToPng(0, tempFile);

                // saveFrameToPng() no es síncrono; sondeo cada 20ms (antes
                // 100ms) para no esperar de más una vez listo el archivo.
                var waited = 0;
                var POLL_STEP = 20;
                if (pngResult && typeof pngResult._isReady !== "undefined") {
                    while (!pngResult._isReady && waited < 5000) {
                        $.sleep(POLL_STEP);
                        waited += POLL_STEP;
                    }
                } else {
                    while ((!tempFile.exists || tempFile.length === 0) && waited < 5000) {
                        $.sleep(POLL_STEP);
                        waited += POLL_STEP;
                    }
                }

                if (!tempFile.exists || tempFile.length === 0) {
                    _vantyxLastRenderError = "PNG_NOT_CREATED (path=" + tempFile.fsName + ", waited=" + waited +
                        "ms, exists=" + tempFile.exists + ", size=" + (tempFile.exists ? tempFile.length : "n/a") +
                        "b, hadIsReady=" + (pngResult && typeof pngResult._isReady !== "undefined") + ")";
                } else {
                    var png = decodePNGFile(tempFile);
                    if (!png) {
                        _vantyxLastRenderError = "PNG_DECODE_FAILED (size=" + tempFile.length + "b, reason=" + _vantyxLastDecodeError + ")";
                    } else {
                        var colors = sampleDecodedPngGrid(png, cols, rows);
                        if (colors.length === 0) {
                            _vantyxLastRenderError = "ALL_PIXELS_TRANSPARENT (w=" + png.width + " h=" + png.height + " ch=" + png.channels + ")";
                        } else {
                            resultsByLayer[li] = colors;
                            _vantyxLastRenderError = ""; // éxito, limpia cualquier error previo
                        }
                    }
                }
            } catch (eRenderOne) {
                _vantyxLastRenderError = eRenderOne.toString() + (eRenderOne.line ? (" (line " + eRenderOne.line + ")") : "");
            }

            errorsByLayer[li] = _vantyxLastRenderError;
            _vantyxLastRenderError = "";
            try { if (tempFile && tempFile.exists) tempFile.remove(); } catch (eDel) {}
        }

        if (currentlySoloed) trySetSolo(currentlySoloed, false);
    } catch (eBatch) {
        var batchErr = eBatch.toString() + (eBatch.line ? (" (line " + eBatch.line + ")") : "");
        for (var be = 0; be < n; be++) {
            if (resultsByLayer[be].length === 0 && !errorsByLayer[be]) errorsByLayer[be] = batchErr;
        }
    } finally {
        if (tempCompLayer) { try { tempCompLayer.remove(); } catch (eRemLayer) {} }
        if (tempComp) { try { tempComp.remove(); } catch (eRemComp) {} }
        for (i = 1; i <= comp.numLayers; i++) {
            if (prevSolo[i - 1] !== undefined) trySetSolo(comp.layer(i), prevSolo[i - 1]);
        }
        for (var pe = 0; pe < n; pe++) {
            if (prevEnabledByIndex[pe] !== undefined) {
                try { avLayers[pe].enabled = prevEnabledByIndex[pe]; } catch (eEnable) {}
            }
        }
        app.endUndoGroup();
    }

    return { colors: resultsByLayer, errors: errorsByLayer };
}

// --- Fallback antiguo (sampleImage puntual) si el render/decode falla ---
function sampleLayerGrid(layer, comp, cols, rows) {
    var found = [];
    if (!layer || typeof layer.sampleImage !== "function") return found;

    var w = 100, h = 100;
    try {
        if (layer.source && layer.source.width && layer.source.height) {
            w = layer.source.width;
            h = layer.source.height;
        } else if (layer.width && layer.height) {
            w = layer.width;
            h = layer.height;
        }
    } catch (eSrc) {}

    var currentTime = (comp && comp.time !== undefined) ? comp.time : 0;
    var stepX = w / (cols + 1);
    var stepY = h / (rows + 1);

    for (var x = 1; x <= cols; x++) {
        for (var y = 1; y <= rows; y++) {
            var point = [stepX * x, stepY * y];
            var sample = null;
            try {
                sample = layer.sampleImage(point, [1, 1], true, currentTime);
            } catch (eSample) { sample = null; }

            if (sample && sample.length >= 3) {
                var alpha = sample.length >= 4 ? sample[3] : 1;
                if (alpha > 0.05) found.push(rgbToHex(sample[0], sample[1], sample[2]));
            }
        }
    }
    return found;
}

// ---------------------------------------------------------------------
// Extrae una paleta de colores reales de TODAS las capas seleccionadas,
// sin duplicados (ni exactos ni "casi iguales" dentro de la tolerancia).
// Para capas de imagen/vídeo, renderiza el frame real a PNG y decodifica
// los píxeles a mano; si eso falla, cae al muestreo por sampleImage().
// ---------------------------------------------------------------------
function pullColorsFromSelectedLayers() {
    var TOLERANCE = 28;      // fusiona tonos muy parecidos
    var MAX_COLORS = 24;     // límite de paleta resultante
    var GRID_COLS = 6;
    var GRID_ROWS = 6;

    var result = [];
    var debugParts = [];
    try {
        if (!(app.project && app.project.activeItem && app.project.activeItem instanceof CompItem)) {
            return "NO_SELECTION";
        }
        var comp = app.project.activeItem;
        var layers = comp.selectedLayers;
        if (!layers || layers.length === 0) return "NO_SELECTION";

        // Fase 1: identifica qué capas seleccionadas son AVLayer e intenta
        // primero el muestreo directo (sampleImage) en todas ellas: sin
        // crear comps ni renderizar a PNG, prácticamente instantáneo.
        var isAvFlags = [];
        var layerColorsArr = [];
        var stepsUsedArr = [];
        var errorArr = [];
        var i;
        for (i = 0; i < layers.length; i++) {
            layerColorsArr[i] = [];
            stepsUsedArr[i] = "none";
            errorArr[i] = "";
            var isAv = false;
            try { isAv = (layers[i] instanceof AVLayer); } catch (eCheck) { isAv = false; }
            isAvFlags[i] = isAv;

            if (isAv) {
                var quick = sampleLayerGrid(layers[i], comp, GRID_COLS, GRID_ROWS);
                if (quick.length > 0) {
                    layerColorsArr[i] = quick;
                    stepsUsedArr[i] = "sampleImage";
                }
            }
        }

        // Fase 2: SOLO para las capas AV donde el muestreo directo no dio
        // ningún color (casos raros: ciertos precomps/efectos/mattes de
        // seguimiento), se renderiza un único lote real como respaldo —
        // igual de fiel que antes, pero ya no es el camino por defecto.
        var pendingLayers = [];
        var pendingIndexMap = [];
        for (i = 0; i < layers.length; i++) {
            if (isAvFlags[i] && layerColorsArr[i].length === 0) {
                pendingLayers.push(layers[i]);
                pendingIndexMap.push(i);
            }
        }
        if (pendingLayers.length > 0) {
            var batch = renderLayersFrameColorsBatch(pendingLayers, comp, GRID_COLS, GRID_ROWS);
            for (var k = 0; k < pendingLayers.length; k++) {
                var origIdx = pendingIndexMap[k];
                var colorsFromRender = batch.colors[k] || [];
                if (colorsFromRender.length > 0) {
                    layerColorsArr[origIdx] = colorsFromRender;
                    stepsUsedArr[origIdx] = "render";
                } else {
                    errorArr[origIdx] = batch.errors[k] || "";
                }
            }
        }

        // Fase 3: último recurso, igual que antes: inspección de propiedades
        // (color de fill, texto, sólido) si nada de lo anterior dio color.
        for (i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var isAvLayer = isAvFlags[i];

            if (layerColorsArr[i].length === 0) {
                var single = getLayerColor(layer);
                if (single) { layerColorsArr[i] = [single]; stepsUsedArr[i] = "properties"; }
            }

            debugParts.push(layer.name + ":AV=" + isAvLayer + ":" + stepsUsedArr[i] + ":n=" + layerColorsArr[i].length +
                (errorArr[i] ? (":err=" + errorArr[i]) : ""));

            for (var j = 0; j < layerColorsArr[i].length; j++) {
                if (result.length >= MAX_COLORS) break;
                addColorWithTolerance(result, layerColorsArr[i][j], TOLERANCE);
            }
        }
    } catch (e) {
        return "ERROR:" + e.toString();
    }

    if (result.length === 0) {
        return "NO_COLORS_DEBUG:" + debugParts.join(" | ");
    }

    var json = "[";
    for (var kk = 0; kk < result.length; kk++) {
        json += '"' + result[kk] + '"';
        if (kk < result.length - 1) json += ",";
    }
    json += "]";
    return json;
}
