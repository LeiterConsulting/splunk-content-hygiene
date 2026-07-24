import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(
    workspaceDirectory,
    'packages',
    'content-hygiene',
    'stage'
);
const distDirectory = path.join(workspaceDirectory, 'dist');
const packageStage = path.join(distDirectory, '.content-hygiene-package');
const appDirectory = path.join(packageStage, 'content_hygiene');
const version = (
    await readFile(path.resolve(workspaceDirectory, '..', 'VERSION'), 'utf8')
).trim();

if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
}

const artifact = path.join(
    distDirectory,
    `content_hygiene-${version}.tar.gz`
);

async function removeMacMetadata(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directory, entry.name);
            if (
                entry.name === '.DS_Store' ||
                entry.name === '__MACOSX' ||
                entry.name.startsWith('._')
            ) {
                await rm(entryPath, { recursive: true, force: true });
                return;
            }
            if (entry.isDirectory()) {
                await removeMacMetadata(entryPath);
            }
        })
    );
}

if (!packageStage.startsWith(`${distDirectory}${path.sep}`)) {
    throw new Error('Refusing to clean a package staging path outside dist.');
}

await rm(packageStage, { recursive: true, force: true });
await mkdir(appDirectory, { recursive: true });
await cp(sourceDirectory, appDirectory, { recursive: true });
await removeMacMetadata(packageStage);
await rm(artifact, { force: true });

const result = spawnSync(
    'tar',
    ['-czf', artifact, '-C', packageStage, 'content_hygiene'],
    {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
        encoding: 'utf8',
    }
);

await rm(packageStage, { recursive: true, force: true });

if (result.status !== 0) {
    throw new Error(result.stderr || 'Unable to create the Splunk app archive.');
}

process.stdout.write(`${artifact}\n`);
