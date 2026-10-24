#!/usr/bin/env node
'use strict';

/**
 * Give every product of the seed catalogue its URL slug.
 *
 *   node scripts/assign_catalog_slugs.js          write the slugs, re-emit the derived files
 *   node scripts/assign_catalog_slugs.js --check  exit 1 if any file is not what a write would produce
 *
 * src/data/catalog_products.js is the source; the browser bundle (window.PRODUCTS_DATA) and
 * data/catalog.json are derived from it exactly as build_redesign.py _emit_catalog_assets does
 * (tests/unit/catalog_assets_in_sync.test.js keeps all three identical). This script edits the
 * source and re-emits the other two the same way, so it does not need Python or a shell rebuild.
 *
 * The slug is productSlug(title, id): see server/modules/catalog/domain/ProductSlug.js. The id is
 * never touched. It is the immutable key orders, carts, reviews and stock are filed under; the
 * old ids stay valid forever and the server answers them with a permanent redirect to the slug.
 * Running this twice changes nothing.
 */

const fs = require('fs');
const path = require('path');
const { productSlug } = require('../server/modules/catalog/domain/ProductSlug');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'data', 'catalog_products.js');
const BUNDLE = path.join(ROOT, 'src', 'data', 'catalog_products_bundle.js');
const JSON_COPY = path.join(ROOT, 'data', 'catalog.json');
const PUBLIC_JSON = path.join(ROOT, 'public', 'data', 'catalog.json');

const BUNDLE_HEADER = '/** LOUMOO Catalog Products Browser Bundle (Decoupled) */\nwindow.PRODUCTS_DATA = ';
const SOURCE_SHAPE = /^([\s\S]*?export\s+const\s+catalogProducts\s*=\s*)(\{[\s\S]*?\});?\s*$/;

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** The catalogue with `slug` right after `id` in every product. Throws if two products would share one. */
function withSlugs(catalog) {
  const out = {};
  const taken = new Map();
  for (const id of Object.keys(catalog)) {
    const product = catalog[id];
    const slug = productSlug(product.title, id);
    if (taken.has(slug)) {
      throw new Error(`products "${taken.get(slug)}" and "${id}" would both be at /product/${slug}`);
    }
    taken.set(slug, id);
    const next = {};
    for (const key of Object.keys(product)) {
      if (key === 'slug') continue;
      next[key] = product[key];
      if (key === 'id') next.slug = slug;
    }
    if (!('id' in product)) next.slug = slug;
    out[id] = next;
  }
  return out;
}

/** The three files a write would leave on disk, as text. */
function render() {
  const text = read(SOURCE);
  const match = SOURCE_SHAPE.exec(text);
  if (!match) throw new Error('src/data/catalog_products.js does not have the `export const catalogProducts = {...};` shape');
  const catalog = withSlugs(JSON.parse(match[2]));
  const body = JSON.stringify(catalog, null, 2);
  return {
    count: Object.keys(catalog).length,
    source: `${match[1]}${body};\n`,
    bundle: `${BUNDLE_HEADER}${body};\n`,
    json: body
  };
}

function main() {
  const check = process.argv.includes('--check');
  const next = render();
  const files = [
    ['src/data/catalog_products.js', SOURCE, next.source],
    ['src/data/catalog_products_bundle.js', BUNDLE, next.bundle],
    ['data/catalog.json', JSON_COPY, next.json]
  ];
  const stale = files.filter(([, file, text]) => !fs.existsSync(file) || read(file) !== text).map(([name]) => name);

  if (check) {
    if (stale.length) {
      console.error(`Catalogue slugs are out of date in: ${stale.join(', ')}. Run: node scripts/assign_catalog_slugs.js`);
      process.exit(1);
    }
    console.log(`All ${next.count} catalogue products carry their slug, in all three files.`);
    return;
  }

  files.forEach(([, file, text]) => { if (!fs.existsSync(file) || read(file) !== text) fs.writeFileSync(file, text, 'utf8'); });
  if (fs.existsSync(path.join(ROOT, 'public'))) {
    fs.mkdirSync(path.dirname(PUBLIC_JSON), { recursive: true });
    fs.copyFileSync(JSON_COPY, PUBLIC_JSON);
  }
  console.log(stale.length ? `Updated ${stale.join(', ')} (${next.count} products).` : `Already up to date (${next.count} products).`);
}

if (require.main === module) main();

module.exports = { withSlugs, render };
