import { createStaticURL } from '@splunk/splunk-utils/url';

// Simple XML may evaluate the entry rather than attach a script element.
// Webpack's automatic currentScript detection can then select native/CDN
// scripts. Resolve our chunks explicitly, preserving locale, proxy and build.
/* eslint-disable camelcase, no-underscore-dangle, no-unused-vars, prefer-const -- Webpack requires this exact assignable runtime identifier. */
declare let __webpack_public_path__: string;
__webpack_public_path__ = createStaticURL('app/content_hygiene/pages/');
/* eslint-enable camelcase, no-underscore-dangle, no-unused-vars, prefer-const */
