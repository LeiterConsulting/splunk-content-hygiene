module.exports = {
    testMatch: ['**/*.unit.[jt]s?(x)'],
    testEnvironment: 'jsdom',
    // Native UI suites are CPU-heavy. Bound workers instead of relaxing their
    // assertions/timeouts on shared developer machines with many logical CPUs.
    maxWorkers: 2,
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
