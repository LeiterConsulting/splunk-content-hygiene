const { defineConfig } = require('eslint/config');
const globals = require('globals');
const browserPrettier = require('@splunk/eslint-config/browser-prettier');
const tsParser = require('@typescript-eslint/parser');

module.exports = defineConfig(
    browserPrettier,
    {
        files: ['src/**/*.{ts,tsx,js,jsx}'],
        languageOptions: {
            parser: tsParser,
        },
        rules: {
            'react/jsx-filename-extension': ['error', { extensions: ['.tsx', '.jsx'] }],
            'no-undef': 'off',
            'no-unused-vars': 'off',
            'import/no-extraneous-dependencies': [
                'error',
                { devDependencies: ['src/**/tests/*.unit*'] },
            ],
        },
    },
    {
        files: ['src/**/tests/*.unit*'],
        languageOptions: {
            globals: globals.jest,
        },
    }
);
