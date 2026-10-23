import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, '..');
const version = (
    await readFile(path.resolve(workspaceDirectory, '..', 'VERSION'), 'utf8')
).trim();
const artifact = path.resolve(
    workspaceDirectory,
    'dist',
    `content_hygiene-${version}.tar.gz`
);
const appBuild = (await readFile(path.join(workspaceDirectory, 'packages/content-hygiene/src/main/resources/splunk/default/app.conf'), 'utf8'))
    .match(/^build\s*=\s*(\d+)\s*$/m)?.[1];
if (!appBuild) throw new Error('An explicit app build is required.');
const hostScript = `ContentHygiene.build${appBuild}.js`;

await access(artifact);

const result = spawnSync('tar', ['-tzf', artifact], {
    encoding: 'utf8',
});

if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to inspect the release archive.');
}

const entries = result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
const forbiddenSegments = [
    '/node_modules/',
    '/.git/',
    '/local/',
    '/tests/',
    '/coverage/',
    '/__pycache__/',
    '.pyc',
    '/demoData',
    '.map',
];
const forbiddenProductionText = [
    'demo data',
    'demo snapshot',
    'demonstration snapshot',
    'packaged demonstration',
];

if (entries.length === 0) {
    throw new Error('Release archive is empty.');
}

if (entries.some((entry) => !entry.startsWith('content_hygiene/'))) {
    throw new Error('Release archive must have one content_hygiene top-level directory.');
}

const requiredEntries = [
    'content_hygiene/LICENSE',
    'content_hygiene/THIRD_PARTY_NOTICES.txt',
    'content_hygiene/default/app.conf',
    'content_hygiene/default/restmap.conf',
    'content_hygiene/default/web.conf',
    'content_hygiene/bin/content_hygiene_reviews.py',
    `content_hygiene/appserver/static/pages/${hostScript}`,
    'content_hygiene/appserver/static/content-hygiene-host.css',
];
const iconSizes = {
    'appIcon.png': [36, 36],
    'appIcon_2x.png': [72, 72],
    'appIconAlt.png': [36, 36],
    'appIconAlt_2x.png': [72, 72],
    'appLogo.png': [160, 40],
    'appLogo_2x.png': [320, 80],
};
for (const file of Object.keys(iconSizes)) {
    requiredEntries.push(`content_hygiene/static/${file}`, `content_hygiene/appserver/static/${file}`);
}
const views = ['Overview', 'CleanupCandidates', 'DependencyExplorer', 'ReviewLibrary', 'Ownership', 'Settings'];
for (const view of views) {
    requiredEntries.push(`content_hygiene/default/data/ui/views/${view}.xml`);
}
const missingEntry = requiredEntries.find((entry) => !entries.includes(entry));

if (missingEntry) {
    throw new Error(`Release archive is missing required entry: ${missingEntry}`);
}

const macMetadataEntry = entries.find((entry) =>
    entry
        .split('/')
        .some(
            (segment) =>
                segment === '.DS_Store' ||
                segment === '__MACOSX' ||
                segment.startsWith('._')
        )
);

if (macMetadataEntry) {
    throw new Error(
        `Release archive contains macOS metadata: ${macMetadataEntry}`
    );
}

const forbiddenEntry = entries.find((entry) =>
    forbiddenSegments.some((segment) => entry.includes(segment))
);

if (forbiddenEntry) {
    throw new Error(`Release archive contains forbidden entry: ${forbiddenEntry}`);
}

const inspectionDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'content-hygiene-package-')
);
try {
    const extraction = spawnSync(
        'tar',
        ['-xzf', artifact, '-C', inspectionDirectory],
        { encoding: 'utf8' }
    );
    if (extraction.status !== 0) {
        throw new Error(
            extraction.stderr || 'Unable to extract the release archive.'
        );
    }

    for (const [file, [width, height]] of Object.entries(iconSizes)) {
        const launcher = await readFile(path.join(inspectionDirectory, 'content_hygiene/static', file));
        const web = await readFile(path.join(inspectionDirectory, 'content_hygiene/appserver/static', file));
        if (!launcher.equals(web)) {
            throw new Error(`Launcher and web branding differ: ${file}`);
        }
        if (launcher.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
            launcher.readUInt32BE(16) !== width || launcher.readUInt32BE(20) !== height ||
            launcher[25] !== 6) {
            throw new Error(`Branding must be a ${width}x${height} RGBA PNG: ${file}`);
        }
    }
    if (entries.some((entry) => entry.includes('/appserver/templates/'))) {
        throw new Error('The portable dashboard host must not package custom Mako templates.');
    }
    for (const view of views) {
        const xml = await readFile(path.join(inspectionDirectory, `content_hygiene/default/data/ui/views/${view}.xml`), 'utf8');
        if (!xml.includes('<dashboard version="1.1"') ||
            !xml.includes(`script="pages/${hostScript}"`) ||
            !xml.includes('stylesheet="content-hygiene-host.css"') ||
            !xml.includes('hideChrome="false"') || !xml.includes('hideSplunkBar="false"') ||
            !xml.includes('hideAppBar="false"') || !xml.includes('id="content-hygiene-root"') ||
            /<search\b|template=|theme=/i.test(xml)) {
            throw new Error(`Invalid native, theme-inheriting dashboard host: ${view}`);
        }
    }

    const textEntries = entries.filter((entry) =>
        /\.(?:js|html|md|conf|xml)$/i.test(entry)
    );
    for (const entry of textEntries) {
        const contents = await readFile(path.join(inspectionDirectory, entry), 'utf8');
        const forbiddenText = forbiddenProductionText.find((value) =>
            contents.toLowerCase().includes(value)
        );
        if (forbiddenText) {
            throw new Error(
                `Release archive contains forbidden production text "${forbiddenText}" in ${entry}`
            );
        }
    }
} finally {
    await rm(inspectionDirectory, { recursive: true, force: true });
}

process.stdout.write(
    `Verified ${entries.length} package entries in ${path.basename(artifact)}\n`
);
