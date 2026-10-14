// =========================================================
//  Vantyx Flow - client/js/CSInterface.js
//  Wrapper mínimo propio para comunicarse con el entorno CEP
//  de Adobe (After Effects) usando el objeto global que CEP
//  inyecta automáticamente: window.__adobe_cep__
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

window.VantyxCSInterface = VantyxCSInterface;
