const { defineConfig } = require('eslint/config');
const browserPrettier = require('@splunk/eslint-config/browser-prettier');
const tsParser = require('@typescript-eslint/parser');
const globals = require('globals');

module.exports = defineConfig(browserPrettier, {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
        parser: tsParser,
    },
    rules: {
        'react/jsx-filename-extension': ['error', { extensions: ['.tsx', '.jsx'] }],
    },
}, {
    files: ['src/**/tests/*.unit*'],
    languageOptions: { globals: globals.jest },
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
});
