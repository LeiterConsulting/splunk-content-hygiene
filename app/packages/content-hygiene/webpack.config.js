const path = require('path');
const fs = require('fs');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { merge: webpackMerge } = require('webpack-merge');
const baseConfig = require('@splunk/webpack-configs/base.config').default;

const DEBUG = process.env.NODE_ENV !== 'production';
const appBuild = fs.readFileSync(path.join(__dirname, 'src/main/resources/splunk/default/app.conf'), 'utf8')
    .match(/^build\s*=\s*(\d+)\s*$/m)?.[1];
if (!appBuild) throw new Error('An explicit app build is required for the native script filename.');
const hostScript = `ContentHygiene.build${appBuild}.js`;

module.exports = webpackMerge(baseConfig, {
    // One cacheable shell; each view loads its own deferred page chunk.
    entry: { ContentHygiene: path.join(__dirname, 'src/main/webapp/bootstrap.ts') },
    output: {
        path: path.join(__dirname, 'stage/appserver/static/pages/'),
        filename: hostScript,
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
                    transform: (content, absolutePath) => absolutePath.endsWith('.xml')
                        ? Buffer.from(content.toString().replace('script="pages/ContentHygiene.js"', `script="pages/${hostScript}"`))
                        : content,
                },
            ],
        }),
    ],
    devtool: DEBUG ? 'eval-source-map' : false,
    module: {
        rules: [{ test: /\.css$/, use: 'css-loader' }],
    },
});
