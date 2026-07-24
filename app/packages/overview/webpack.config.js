const path = require('path');
const { merge: webpackMerge } = require('webpack-merge');
const baseComponentConfig = require('@splunk/webpack-configs/component.config').default;

module.exports = webpackMerge(baseComponentConfig, {
    entry: {
        ContentHygieneApp: path.join(__dirname, 'src/ContentHygieneApp.tsx'),
    },
    output: {
        path: path.join(__dirname),
    },
});
