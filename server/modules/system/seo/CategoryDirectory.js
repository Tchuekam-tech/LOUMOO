'use strict';

/**
 * LOUMOO — the public category directory (which /marketplace/category/:category
 * pages exist, and what each is called).
 * ---------------------------------------------------------------------------
 * The category screen accepts any slug, so without a directory every
 * /marketplace/category/<anything> answered 200 index,follow: an unbounded set of
 * soft-404 pages. This module is the one answer, shared by the prerender (200 with
 * the category's own title, or a real 404) and the sitemap (which categories to
 * list). Sources, both static and shipped with the app (no database):
 *
 *   1. the taxonomy dataset (src/data/categories.js): id, name, description;
 *   2. the curated catalogue's own product categories (a category with products
 *      is a page buyers reach even when the taxonomy does not describe it).
 *
 * The canonical slug is the taxonomy `id` (what the shell's category screen keys
 * on, e.g. `real_estate`); its URL-style alias (`real-estate`) resolves to it.
 * Never throws: a missing dataset yields an empty directory.
 *
 * NAMES. The page title, description and crawler links use the French copy in
 * FRENCH below (the primary search market). The taxonomy dataset only names some
 * categories; for the rest the name used to come from the FIRST curated product's
 * sub-category label, so /marketplace/category/beauty was titled "Parfums &
 * Fragrances Masculines", /sports "Chaussures de Sport & Running", /groceries
 * "Fruits, Légumes & Produits Frais" and /jewelry "Bijoux & Bracelets": one
 * sub-category speaking for a whole category. The shell's own category screen keeps
 * its English labels; `nameEn` carries the dataset's name.
 */

const SLUG_RE = /^[a-z0-9_-]{1,64}$/;

// Category id -> the French name and description used for SEO. Descriptions only state
// what the category holds; no promise of stock, price, warranty or delivery zone.
const FRENCH = Object.freeze({
  electronics: { name: 'Électronique et high-tech', description: 'Smartphones, ordinateurs portables, audio, accessoires et gadgets proposés par les boutiques LOUMOO. Comparez les modèles et payez à la livraison au Cameroun.' },
  fashion: { name: 'Mode, chaussures et accessoires', description: 'Chaussures, vêtements, sacs, montres et bijoux de mode proposés par les boutiques LOUMOO. Commandez en ligne et payez à la livraison au Cameroun.' },
  home: { name: 'Maison et électroménager', description: 'Petit électroménager, casseroles, vaisselle et articles d’entretien à commander auprès des boutiques LOUMOO, avec paiement à la livraison.' },
  beauty: { name: 'Beauté, parfums et soins', description: 'Parfums, soins du visage, du corps et des cheveux proposés par les boutiques LOUMOO au Cameroun.' },
  sports: { name: 'Sport et fitness', description: 'Chaussures de sport, matériel de fitness et accessoires pour s’entraîner, proposés par les boutiques LOUMOO.' },
  groceries: { name: 'Épicerie et produits frais', description: 'Café, thé, miel, huiles, céréales, confiseries et boissons : des produits d’épicerie à commander sur LOUMOO.' },
  jewelry: { name: 'Bijoux et parures', description: 'Bijoux, bracelets et parures proposés par les boutiques LOUMOO.' },
  services: { name: 'Services professionnels', description: 'Prestations et services proposés par des prestataires présents sur LOUMOO.' },
  travel: { name: 'Voyages et transport', description: 'Transport interurbain, voyages et mobilité : les offres à découvrir sur LOUMOO.' },
  hospitality: { name: 'Hôtellerie et séjours', description: 'Hôtels et séjours à découvrir sur LOUMOO.' },
  hotels: { name: 'Hôtels et hébergement', description: 'Hôtels et hébergements à découvrir sur LOUMOO.' },
  automotive: { name: 'Véhicules et automobile', description: 'Véhicules et produits automobiles sur LOUMOO.' },
  real_estate: { name: 'Immobilier', description: 'Annonces immobilières sur LOUMOO.' },
  banks: { name: 'Banques et services financiers', description: 'Services bancaires et financiers référencés sur LOUMOO.' },
  digital: { name: 'Produits numériques et logiciels', description: 'Produits numériques et logiciels sur LOUMOO.' }
});

let cache = null;

function titleCase(slug) {
  return String(slug).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function build() {
  const byId = new Map();
  const aliases = new Map();

  let taxonomy = [];
  let curatedCards = [];
  try { taxonomy = require('../../catalog/dataLoader').categories || []; } catch (_) { taxonomy = []; }
  try { curatedCards = require('../../catalog/infrastructure/CatalogRepository')._curatedCards() || []; } catch (_) { curatedCards = []; }

  for (const c of taxonomy) {
    const id = c && String(c.id || '').toLowerCase();
    if (!id || id === 'all' || !SLUG_RE.test(id)) continue;
    byId.set(id, { id, name: c.name || titleCase(id), nameEn: c.name || titleCase(id), description: c.description || '', productCount: 0 });
    const slug = String(c.slug || '').toLowerCase();
    if (slug && slug !== id && SLUG_RE.test(slug)) aliases.set(slug, id);
  }

  for (const card of curatedCards) {
    const id = card && String(card.category || '').toLowerCase();
    if (!id || id === 'all' || id === 'general' || !SLUG_RE.test(id)) continue;
    const key = aliases.get(id) || id;
    if (!byId.has(key)) {
      byId.set(key, { id: key, name: card.categoryLabel || titleCase(key), nameEn: card.categoryLabel || titleCase(key), description: '', productCount: 0 });
    }
    byId.get(key).productCount += 1;
  }

  // French SEO copy wins over the dataset's English (or sub-category) names.
  for (const entry of byId.values()) {
    const fr = FRENCH[entry.id];
    if (fr) { entry.name = fr.name; entry.description = fr.description; }
  }

  return { byId, aliases };
}

function directory() {
  if (!cache) cache = build();
  return cache;
}

/** The category for `slug` (its id or URL alias), or null when it is not a page. */
function find(slug) {
  const s = String(slug == null ? '' : slug).toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const { byId, aliases } = directory();
  return byId.get(s) || byId.get(aliases.get(s)) || null;
}

/** Every known category, taxonomy order first. */
function list() {
  return Array.from(directory().byId.values());
}

/** The canonical path of a category page. */
function pathFor(category) {
  return `/marketplace/category/${encodeURIComponent(category.id)}`;
}

/** Test seam: forget the cached directory. */
function _reset() { cache = null; }

module.exports = { find, list, pathFor, FRENCH, _reset };
