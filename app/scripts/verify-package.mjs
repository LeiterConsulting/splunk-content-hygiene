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
