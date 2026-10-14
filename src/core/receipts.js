'use strict';
// Install receipts: the single source of truth for "what did the Hub put on
// disk". Uninstall only ever touches files listed here.
const fs = require('fs');
const path = require('path');

class ReceiptStore {
    constructor(dataDir) {
        this.dir = dataDir;
        this.file = path.join(dataDir, 'receipts.json');
        this.warning = null;
    }

    _load() {
        let text;
        try { text = fs.readFileSync(this.file, 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') return { version: 1, installs: {} }; throw e; }
        try {
            const d = JSON.parse(text);
            if (!d || typeof d !== 'object' || typeof d.installs !== 'object' || d.installs === null) throw new Error('shape');
            return d;
        } catch (e) {
            // Keep the broken file for inspection and start clean: nothing
            // is deleted because of this; tools just show as unmanaged.
            const bak = this.file + '.corrupt-' + Date.now();
            try { fs.renameSync(this.file, bak); } catch (e2) { /* ignore */ }
            this.warning = 'receipts.json was corrupt and was moved to ' + bak;
            return { version: 1, installs: {} };
        }
    }

    _save(d) {
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
        fs.renameSync(tmp, this.file);
    }

    static key(id, targetKey) { return id + '@' + targetKey; }

    get(id, targetKey) { return this._load().installs[ReceiptStore.key(id, targetKey)] || null; }
    list() { return Object.values(this._load().installs); }

    put(receipt) {
        const d = this._load();
        d.installs[ReceiptStore.key(receipt.id, receipt.targetKey)] = receipt;
        this._save(d);
    }

    remove(id, targetKey) {
        const d = this._load();
        delete d.installs[ReceiptStore.key(id, targetKey)];
        this._save(d);
    }
}

module.exports = { ReceiptStore };
