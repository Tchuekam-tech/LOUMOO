'use strict';
require('esbuild').buildSync({
  entryPoints: ['src/services/combiEntry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'LoumooCombiSDK',
  platform: 'browser',
  target: 'es2020',
  outfile: 'src/vendor/combi.js',
  legalComments: 'linked',
});
// The SDK embeds worklet source with insignificant trailing indentation.
const fs = require('node:fs');
fs.writeFileSync(
  'src/vendor/combi.js',
  fs.readFileSync('src/vendor/combi.js', 'utf8').replace(/[\t ]+$/gm, ''),
);
