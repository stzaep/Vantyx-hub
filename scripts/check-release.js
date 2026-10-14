'use strict';
// Sanity checks before publishing: valid version, feed configured, tag matches.
//   node scripts/check-release.js            (also runs in `npm run release`)
// In CI the tag is read from GITHUB_REF_NAME (e.g. v0.2.0).
const fs = require('fs');
const path = require('path');
const version = require('../src/core/version');
const { parseFeedConfig, isFeedConfigured } = require('../src/core/updater');

function publishBlock(yml) {
    const lines = String(yml).split(/\r?\n/);
    const i = lines.findIndex(l => /^publish:\s*$/.test(l));
    if (i < 0) return '';
    const out = [];
    for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j]) || lines[j].trim() === ''); j++) out.push(lines[j].replace(/^\s+/, ''));
    return out.join('\n');
}

function checkRelease({ pkg, ymlText, tag }) {
    const problems = [];
    if (!pkg || !version.isValid(pkg.version)) problems.push('package.json "version" is not a valid semver (x.y.z): ' + (pkg && pkg.version));
    const feed = parseFeedConfig(publishBlock(ymlText));
    if (!isFeedConfigured(feed)) problems.push('electron-builder.yml "publish" is not configured (replace the YOUR_* placeholders).');
    if (tag && /^v?\d/.test(tag) && pkg && tag.replace(/^v/, '') !== pkg.version) {
        problems.push('Git tag ' + tag + ' does not match package.json version ' + pkg.version + '.');
    }
    return problems;
}

module.exports = { checkRelease, publishBlock };

if (require.main === module) {
    const root = path.join(__dirname, '..');
    const problems = checkRelease({
        pkg: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
        ymlText: fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'),
        tag: process.env.GITHUB_REF_NAME || ''
    });
    if (problems.length) { problems.forEach(p => console.error('x ' + p)); process.exit(1); }
    console.log('Release checks passed.');
}
