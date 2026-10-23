const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { merge: webpackMerge } = require('webpack-merge');
const baseConfig = require('@splunk/webpack-configs/base.config').default;

const DEBUG = process.env.NODE_ENV !== 'production';

module.exports = webpackMerge(baseConfig, {
    // One cacheable shell; each view loads its own deferred page chunk.
    entry: { ContentHygiene: path.join(__dirname, 'src/main/webapp/bootstrap.ts') },
    output: {
        path: path.join(__dirname, 'stage/appserver/static/pages/'),
        filename: '[name].js',
        // publicPath.ts establishes the native, cache-busted app URL before
        // any deferred page import. Do not infer it from native/CDN scripts.
        publicPath: '',
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.join(__dirname, 'src/main/resources/splunk'),
                    to: path.join(__dirname, 'stage'),
                },
            ],
        }),
    ],
    devtool: DEBUG ? 'eval-source-map' : false,
    module: {
        rules: [{ test: /\.css$/, use: 'css-loader' }],
    },
});
