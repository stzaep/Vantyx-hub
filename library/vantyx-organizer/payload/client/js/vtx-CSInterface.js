// =========================================================
//  Vantyx Organizer - client/js/vtx-CSInterface.js
//  Mismo wrapper mínimo que Vantyx Studio (window.__adobe_cep__),
//  con un método extra para localizar la carpeta de la extensión.
// =========================================================

function VantyxCSInterface() {}

VantyxCSInterface.prototype.evalScript = function (script, callback) {
    if (!window.__adobe_cep__) {
        if (callback) callback(JSON.stringify({ ok: false, error: "Entorno CEP no disponible." }));
        return;
    }
    window.__adobe_cep__.evalScript(script, function (result) {
        if (callback) callback(result);
    });
};

// Ruta absoluta (con "/") de la carpeta de la extensión, o "" si no se puede.
VantyxCSInterface.prototype.getExtensionPath = function () {
    try {
        var p = decodeURI(window.__adobe_cep__.getSystemPath('extension'));
        if (/^file:\/\/\/[A-Za-z]:/.test(p)) return p.substring(8);   // Windows: file:///C:/...
        if (p.indexOf('file://') === 0) return p.substring(7);        // macOS:   file:///Users/...
        return p;
    } catch (e) {
        return "";
    }
};

window.VantyxCSInterface = VantyxCSInterface;
