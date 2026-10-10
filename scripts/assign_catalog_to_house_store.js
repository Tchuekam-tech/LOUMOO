#!/usr/bin/env node
/**
 * Assign the curated catalogue to the house store (NanoAfrica).
 *
 * src/data/catalog_products.js is the single source the storefront and the order
 * path both read. Until a real seller lists goods, every product in it is sold by
 * the platform owner's store, so each entry must name NanoAfrica instead of the
 * placeholder merchants it was generated with ("Orca Electronics", ...).
 *
 * Per product this script
 *   - sets      "storeName"      to the house store name,
 *   - adds      "storeId"        (the deterministic id the server resolves to the
 *                                 owner's store row; see HouseStore.js),
 *   - sets      "storeVerified"  to true,
 *   - rewrites  the seller named in the description ("... garantie par Orca
 *                Electronics ...") so the page does not contradict the seller card.
 * It leaves storeCity (the ship-from city the marketplace city filter uses),
 * prices, ratings, sold counts, images and every other field untouched.
 *
 * The edit is textual, not parse-and-stringify: the file is machine generated but
 * checked in, and re-serialising 1.8 MB would turn a six-line-per-product change
 * into a whole-file diff. Idempotent: a second run finds nothing to change.
 *
 *   node scripts/assign_catalog_to_house_store.js          rewrite in place
 *   node scripts/assign_catalog_to_house_store.js --check  change nothing, exit 1 if a rewrite is due
 *
 * The server never trusts this file for WHO owns an order: the seller is derived
 * from the database row of the house store. This only fixes what buyers read.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { HOUSE_STORE } = require('../server/modules/store/domain/HouseStore');

const DEFAULT_FILE = path.resolve(__dirname, '..', 'src', 'data', 'catalog_products.js');

const PRODUCT_OPEN = /^ {2}"([^"]+)": \{\r?$/;
const STORE_NAME = /^( {4})"storeName": "([^"]*)",(\r?)$/;
const STORE_ID = /^ {4}"storeId": "[^"]*",\r?$/;
const STORE_VERIFIED = /^( {4}"storeVerified": )(true|false)(,?\r?)$/;
const DESCRIPTION = /^( {4}"description": ")(.*)(",?\r?)$/;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The seller is named after "par" or "chez" in the generated descriptions. Only
 * that position is rewritten: a brand that happens to share a name with a
 * placeholder store ("Mocassins de Ville Armonía Milano") is the product's maker
 * and stays.
 */
function rewriteDescription(description, previousStoreName) {
  if (!previousStoreName || previousStoreName === HOUSE_STORE.name) return description;
  const seller = new RegExp('\\b(par|chez) ' + escapeRegExp(previousStoreName) + '(?![\\p{L}\\p{N}])', 'gu');
  return description.replace(seller, '$1 ' + HOUSE_STORE.name);
}

/** @returns {{ text: string, products: number, changed: number }} */
function assignCatalogToHouseStore(source) {
  const lines = source.split('\n');
  const out = [];
  let products = 0;
  let changed = 0;
  let current = null; // { storeName, touched } for the product being read

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (PRODUCT_OPEN.test(line)) {
      if (current && current.touched) changed += 1;
      current = { storeName: null, touched: false };
      products += 1;
      out.push(line);
      continue;
    }

    if (!current) {
      out.push(line);
      continue;
    }

    let match = STORE_NAME.exec(line);
    if (match) {
      const [, indent, name, eol] = match;
      current.storeName = name;
      if (name !== HOUSE_STORE.name) current.touched = true;
      out.push(`${indent}"storeName": "${HOUSE_STORE.name}",${eol}`);
      // Always (re)write storeId directly after storeName, dropping a stale one.
      if (STORE_ID.test(lines[i + 1] || '')) i += 1;
      else current.touched = true;
      out.push(`${indent}"storeId": "${HOUSE_STORE.id}",${eol}`);
      continue;
    }

    match = STORE_VERIFIED.exec(line);
    if (match) {
      if (match[2] !== 'true') current.touched = true;
      out.push(`${match[1]}true${match[3]}`);
      continue;
    }

    match = DESCRIPTION.exec(line);
    if (match) {
      const rewritten = rewriteDescription(match[2], current.storeName);
      if (rewritten !== match[2]) current.touched = true;
      out.push(match[1] + rewritten + match[3]);
      continue;
    }

    out.push(line);
  }
  if (current && current.touched) changed += 1;

  return { text: out.join('\n'), products, changed };
}

function loadDataset(source) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/export\s+const\s+/g, 'var '), sandbox);
  return sandbox.catalogProducts || {};
}

/**
 * The rewrite must change only the intended fields. Compared on parsed data so a
 * stray regex match cannot slip through unnoticed.
 */
function assertOnlyIntendedChanges(before, after) {
  const a = loadDataset(before);
  const b = loadDataset(after);
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) throw new Error('product count changed');
  const allowed = new Set(['storeName', 'storeId', 'storeVerified', 'description']);
  for (const id of ids) {
    const x = a[id];
    const y = b[id];
    if (!y) throw new Error(`product ${id} disappeared`);
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (allowed.has(key)) continue;
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) throw new Error(`${id}.${key} changed unexpectedly`);
    }
    if (y.storeName !== HOUSE_STORE.name || y.storeId !== HOUSE_STORE.id || y.storeVerified !== true) {
      throw new Error(`${id} is not assigned to ${HOUSE_STORE.name}`);
    }
  }
}

function run(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const file = argv.find((arg) => !arg.startsWith('--')) || DEFAULT_FILE;
  const before = fs.readFileSync(file, 'utf8');
  const { text, products, changed } = assignCatalogToHouseStore(before);
  if (products === 0) throw new Error(`no products found in ${file}`);
  assertOnlyIntendedChanges(before, text);

  if (check) {
    console.log(`${changed} of ${products} products still need ${HOUSE_STORE.name} as seller`);
    return changed === 0 ? 0 : 1;
  }
  if (text !== before) fs.writeFileSync(file, text, 'utf8');
  console.log(`${HOUSE_STORE.name} (${HOUSE_STORE.id}) now sells ${products} products; ${changed} rewritten`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (err) {
    console.error(`assign_catalog_to_house_store failed: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { assignCatalogToHouseStore, assertOnlyIntendedChanges, rewriteDescription, run };
