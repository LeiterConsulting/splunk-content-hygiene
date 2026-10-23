module.exports = {
    testMatch: ['**/*.unit.[jt]s?(x)'],
    testEnvironment: 'jsdom',
    transformIgnorePatterns: ['/node_modules/(?!@noble/hashes/)'],
    transform: {
        '^.+\\.[jt]sx?$': ['babel-jest', {
            babelrc: false,
            configFile: false,
            presets: ['@splunk/babel-preset'],
        }],
    },
    setupFilesAfterEnv: ['<rootDir>/unit-test-setup-testing-library.ts'],
};
