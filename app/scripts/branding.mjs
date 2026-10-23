import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splunk = path.join(workspace, 'packages/content-hygiene/src/main/resources/splunk');
const verify = process.argv.includes('--check');
const icon = await readFile(path.join(workspace, 'assets/branding/icon.svg'), 'utf8');
const symbol = icon.slice(icon.indexOf('>') + 1, icon.lastIndexOf('</svg>'));

// Original geometric lettering, not an embedded system/commercial font. This
// keeps vector and PNG exports identical on macOS, Linux and Windows.
const letters = {
    C: 'M7 2L6 1H2L1 2V9L2 10H6L7 9',
    O: 'M2 1H6L7 2V9L6 10H2L1 9V2Z',
    N: 'M1 10V1L7 10V1',
    T: 'M0 1H8M4 1V10',
    E: 'M7 1H1V10H7M1 5.5H6',
    H: 'M1 1V10M7 1V10M1 5.5H7',
    Y: 'M0 1L4 5.5L8 1M4 5.5V10',
    G: 'M7 3V2L6 1H2L1 2V9L2 10H6L7 9V6H4',
    I: 'M1 1H7M4 1V10M1 10H7',
};
const word = (text, y, color) => `<g transform="translate(45 ${y}) scale(1.4)" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${[...text].map((letter, index) => `<path transform="translate(${index * 10} 0)" d="${letters[letter]}"/>`).join('')}</g>`;
function logo(color, background = false) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40" role="img" aria-label="Content Hygiene"><title>Content Hygiene</title>${background ? '<rect width="160" height="40" rx="6" fill="#12314b"/>' : ''}<g transform="translate(2 2) scale(.5)">${symbol}</g>${word('CONTENT', 2, color)}${word('HYGIENE', 21, color)}</svg>\n`;
}
const universal = logo('#ffffff', true);
const assets = new Map([
    ['appIcon.png', [icon, 36]],
    ['appIcon_2x.png', [icon, 72]],
    ['appIconAlt.png', [icon, 36]],
    ['appIconAlt_2x.png', [icon, 72]],
    ['appLogo.png', [universal, 160]],
    ['appLogo_2x.png', [universal, 320]],
]);
async function output(filename, data) {
    if (verify) {
        const existing = await readFile(filename).catch(() => null);
        if (!existing || !existing.equals(Buffer.from(data))) throw new Error(`Branding asset is missing or stale: ${path.relative(workspace, filename)}`);
    } else {
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, data);
    }
}
for (const [name, [source, width]] of assets) {
    const png = new Resvg(source, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
    // Classic Launcher/Splunkbase and the Web static endpoint use different
    // documented directories. Keep byte-identical copies in both locations.
    for (const folder of ['static', 'appserver/static']) await output(path.join(splunk, folder, name), png);
}
for (const [name, source] of [['app-mark.svg', icon], ['wordmark-light.svg', logo('#12314b')], ['wordmark-dark.svg', logo('#ffffff')], ['wordmark.svg', universal]]) {
    await output(path.join(splunk, 'appserver/static/brand', name), source);
}
await output(path.join(workspace, '../docs/images/content-hygiene.svg'), universal);
console.log(`${verify ? 'Verified' : 'Generated'} 12 PNG placements and five SVG graphics from original vector sources.`);
