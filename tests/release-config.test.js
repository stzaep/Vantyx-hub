'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const version = require('../src/core/version');
const { checkRelease, publishBlock } = require('../scripts/check-release');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const yml = read('electron-builder.yml');

test('installer config: assisted per-user NSIS with shortcuts, single entry and data kept on uninstall', () => {
    assert.match(yml, /^\s+- target: nsis/m);
    assert.match(yml, /^\s+oneClick: false/m);
    assert.match(yml, /^\s+allowToChangeInstallationDirectory: true/m);
    assert.match(yml, /^\s+perMachine: false/m);
    assert.match(yml, /^\s+createDesktopShortcut: true/m);
    assert.match(yml, /^\s+createStartMenuShortcut: true/m);
    assert.match(yml, /^\s+deleteAppDataOnUninstall: false/m, 'uninstalling the Hub keeps settings and receipts');
    assert.match(yml, /^appId: com\.vantyx\.hub$/m);
    assert.match(yml, /^productName: Vantyx Hub$/m);
    assert.match(yml, /icon: build\/icon\.ico/);
    assert.ok(fs.existsSync(path.join(root, 'build', 'icon.ico')));
    assert.ok(!/portable/.test(yml.split('portable:')[0].match(/target:[\s\S]*?nsis:/)[0]), 'portable is not a default target (avoids duplicate copies)');
    const art = /artifactName: (.+)/.exec(yml)[1];
    assert.ok(!/\s/.test(art), 'installer file name has no spaces (GitHub renames assets, which would break latest.yml)');
});

test('package.json: coherent version, updater dependency, build + release scripts', () => {
    assert.ok(version.isValid(pkg.version));
    assert.ok(pkg.dependencies && pkg.dependencies['electron-updater'], 'electron-updater is a runtime dependency');
    assert.ok(!(pkg.devDependencies || {})['electron-updater']);
    assert.match(pkg.scripts.dist, /electron-builder --win nsis --publish never/);
    assert.match(pkg.scripts.release, /check-release\.js && electron-builder --win nsis --publish always/);
    assert.strictEqual(pkg.main, 'src/main/main.js');
});

test('publish feed points to the GitHub repo given by the owner and releases are not drafts', () => {
    const block = publishBlock(yml);
    assert.match(block, /provider: github/);
    assert.match(block, /owner: stzaep/);
    assert.match(block, /repo: Vantyx-hub/);
    assert.match(block, /releaseType: release/);
});

test('check-release: flags placeholders, bad versions and tag mismatches', () => {
    const good = yml;
    const placeholders = yml.replace('owner: stzaep', 'owner: YOUR_GITHUB_USER').replace('repo: Vantyx-hub', 'repo: YOUR_REPOSITORY_NAME');
    assert.deepStrictEqual(checkRelease({ pkg, ymlText: good, tag: 'v' + pkg.version }), []);
    assert.deepStrictEqual(checkRelease({ pkg, ymlText: good, tag: '' }), []);
    assert.strictEqual(checkRelease({ pkg, ymlText: placeholders, tag: '' }).length, 1, 'placeholders');
    assert.match(checkRelease({ pkg, ymlText: good, tag: 'v9.9.9' })[0], /does not match/);
    assert.match(checkRelease({ pkg: { version: '1.0' }, ymlText: good, tag: '' })[0], /not a valid semver/);
});

test('release workflow publishes on tags using the built-in GITHUB_TOKEN only', () => {
    const wf = read('.github/workflows/release.yml');
    assert.match(wf, /tags: \['v\*'\]/);
    assert.match(wf, /runs-on: windows-latest/);
    assert.match(wf, /npm test/);
    assert.match(wf, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.ok(!/secrets\.(?!GITHUB_TOKEN)/.test(wf), 'no other secrets referenced');
});

test('Electron security: isolation on, node off, no feed override, no secrets shipped in the app', () => {
    const main = read('src/main/main.js');
    assert.match(main, /contextIsolation: true/);
    assert.match(main, /nodeIntegration: false/);
    assert.match(main, /sandbox: true/);
    const files = [];
    (function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(path.join(root, 'src'));
    for (const f of files.filter(f => /\.(js|html)$/.test(f))) {
        const s = fs.readFileSync(f, 'utf8');
        assert.ok(!/setFeedURL/.test(s), 'no runtime feed override: ' + f);
        assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}|GH_TOKEN|GITHUB_TOKEN/.test(s), 'no token: ' + f);
        if (f.includes(path.join('src', 'renderer'))) assert.ok(!/electron-updater|require\(/.test(s.replace(/typeof module[^\n]*/g, '')), 'renderer has no node access: ' + f);
    }
});
