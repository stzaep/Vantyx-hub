'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createSettings } = require('../src/core/settings');
const { tmp, rmrf } = require('./helpers');

test('settings default to auto-check on and survive a restart (new instance, same folder)', () => {
    const root = tmp();
    try {
        const dir = path.join(root, 'Vantyx Hub');
        const a = createSettings({ dir });
        assert.deepStrictEqual(a.get(), { autoCheckUpdates: true, discordRichPresence: false });
        a.set({ autoCheckUpdates: false, discordRichPresence: true });
        // simulates the app after an update: a brand-new process reads the same file
        const b = createSettings({ dir });
        assert.strictEqual(b.get().autoCheckUpdates, false);
        assert.strictEqual(b.get().discordRichPresence, true);
        assert.ok(!fs.existsSync(b.file + '.tmp'), 'no temp file left behind');
    } finally { rmrf(root); }
});

test('settings reject unknown keys, wrong types and malformed input', () => {
    const root = tmp();
    try {
        const s = createSettings({ dir: root });
        for (const bad of [null, [], 'x', {}, { nope: true }, { autoCheckUpdates: 'yes' }, { autoCheckUpdates: 1 }, { autoCheckUpdates: true, other: 1 }]) {
            assert.throws(() => s.set(bad), e => e.code === 'BAD_REQUEST', JSON.stringify(bad));
        }
        assert.strictEqual(s.get().autoCheckUpdates, true, 'nothing changed');
        assert.throws(() => s.set(JSON.parse('{"__proto__": {"x": 1}, "autoCheckUpdates": true}')), e => e.code === 'BAD_REQUEST');
    } finally { rmrf(root); }
});

test('corrupt settings file falls back to defaults; unknown keys from newer versions are kept', () => {
    const root = tmp();
    try {
        const file = path.join(root, 'settings.json');
        fs.writeFileSync(file, '{not json');
        assert.deepStrictEqual(createSettings({ dir: root }).get(), { autoCheckUpdates: true, discordRichPresence: false });

        fs.writeFileSync(file, JSON.stringify({ autoCheckUpdates: false, futureOption: 'keep-me', autoCheckUpdates2: 1 }));
        const s = createSettings({ dir: root });
        s.set({ autoCheckUpdates: true });
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(saved.futureOption, 'keep-me');
        assert.strictEqual(saved.autoCheckUpdates, true);
    } finally { rmrf(root); }
});
