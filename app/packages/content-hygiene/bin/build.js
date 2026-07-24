/* eslint-disable */

const shell = require('shelljs');
const OS = require('os').platform().toLocaleLowerCase();
const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
const commands = ['build', 'link'];

const cleanStage = () => {
    const stageDirectory = path.join(__dirname, '..', 'stage');
    if (path.basename(stageDirectory) !== 'stage') {
        throw new Error('Refusing to clean an unexpected build directory.');
    }
    fs.rmSync(stageDirectory, { recursive: true, force: true });
};

const buildApp = (command) => {
    cleanStage();
    const result = shell.exec(command);
    if (result.code === 0) {
        fs.copyFileSync(
            path.resolve(__dirname, '../../../../LICENSE'),
            path.join(__dirname, '..', 'stage', 'LICENSE')
        );
    }
    return result;
};

if (!arg) {
    shell.echo(
        `No command received, please supply a command to run. \nCommands: ${commands.join(', ')}`
    );
    shell.exit(1);
}

if (!commands.includes(arg)) {
    shell.echo(`Please supply one of the following command to run: ${commands.join(', ')}`);
    shell.exit(1);
}

// prettier-ignore
const runCommands = {
    win32: {
        build: () => buildApp('set NODE_ENV=production&&.\\node_modules\\.bin\\webpack --mode=production'),
        link: () => shell.exec('mklink /D "%SPLUNK_HOME%\\etc\\apps\\content-hygiene" "%cd%\\stage"'),
    },
    nix: {
        build: () => buildApp('export NODE_ENV=production && ./node_modules/.bin/webpack --mode=production'),
        link: () => shell.exec('ln -s $PWD/stage $SPLUNK_HOME/etc/apps/content_hygiene'),
    },
};

try {
    const isWindows = OS === 'win32' || OS === 'win64';
    const os = isWindows ? 'win32' : 'nix';
    const result = runCommands[os][arg]();
    if (result.code !== 0) {
        shell.exit(result.code);
    }
} catch (error) {
    shell.echo(error);
    shell.exit(1);
}
