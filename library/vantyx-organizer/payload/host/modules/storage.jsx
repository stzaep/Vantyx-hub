// =========================================================
//  Vantyx Organizer - host/modules/storage.jsx
//  Persistencia de la configuracion en disco:
//    <userData>/VantyxOrganizer/config.json
//  Escritura segura: se escribe en config.tmp y luego se
//  reemplaza el fichero real, para que un cierre brusco de AE
//  nunca deje el JSON a medias.
// =========================================================
var VTXO = (typeof $.global.VTXO === 'undefined') ? ($.global.VTXO = {}) : $.global.VTXO;

VTXO.storage = (function () {
    function dir() {
        var d = new Folder(Folder.userData.fsName + '/VantyxOrganizer');
        if (!d.exists) d.create();
        return d;
    }

    function readFile(f) {
        f.encoding = 'UTF-8';
        if (!f.open('r')) throw new Error('OPEN_READ_FAILED');
        var s = f.read();
        f.close();
        return s;
    }

    function read() {
        var d = dir();
        var main = new File(d.fsName + '/config.json');
        var tmp = new File(d.fsName + '/config.tmp');
        var text = '';
        var exists = false;
        if (main.exists) { text = readFile(main); exists = true; }
        else if (tmp.exists) { text = readFile(tmp); exists = true; } // cierre a mitad de un guardado previo
        return { text: text, exists: exists, path: main.fsName };
    }

    function write(text) {
        var d = dir();
        if (!d.exists) throw new Error('CONFIG_DIR_UNAVAILABLE');

        var tmp = new File(d.fsName + '/config.tmp');
        tmp.encoding = 'UTF-8';
        if (!tmp.open('w')) throw new Error('OPEN_WRITE_FAILED (enable "Allow Scripts to Write Files" in AE preferences)');
        tmp.write(String(text));
        tmp.close();

        var target = new File(d.fsName + '/config.json');
        if (target.exists) target.remove();
        if (!tmp.rename('config.json')) {
            // rename fallo: copia como ultimo recurso
            if (!tmp.copy(target.fsName)) throw new Error('REPLACE_FAILED');
            tmp.remove();
        }
        return { path: target.fsName };
    }

    return { read: read, write: write };
})();
