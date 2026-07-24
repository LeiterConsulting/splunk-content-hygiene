import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(workspaceDirectory, '..');
const version = (await readFile(path.join(repositoryDirectory, 'VERSION'), 'utf8')).trim();
const artifactName = `content_hygiene-${version}.tar.gz`;
const artifact = path.join(workspaceDirectory, 'dist', artifactName);
const checksumFile = path.join(repositoryDirectory, 'SHA256SUMS');

const digest = createHash('sha256')
    .update(await readFile(artifact))
    .digest('hex');
const checksum = `${digest}  ${artifactName}\n`;

await writeFile(checksumFile, checksum, 'utf8');
process.stdout.write(checksum);
