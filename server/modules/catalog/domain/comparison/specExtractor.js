/**
 * Spec extractor — runs a product type's profile over one canonical product and
 * returns every dimension's value with where it came from and how sure we are.
 *
 *   extract(product, profile) → {
 *     [key]: { value, display, unit, source, confidence, meta? } | null
 *   }
 */

const { parseMemory } = require('./specParsers');
const { lookupChip } = require('./chipIndex');

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
}

function flattenStrings(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') flattenStrings(v, out);
  }
  return out;
}

function buildContext(product) {
  const attributes = product.attributes || [];
  const structuredText = product.structured ? flattenStrings(product.structured) : [];
  const dbText = product.dbAttributes
    ? Object.values(product.dbAttributes).filter(v => typeof v === 'string')
    : [];
  const specText = [...attributes.map(a => a.val), ...structuredText, ...dbText].join(' · ');
  const title = String(product.title || '');

  let memory;
  let chip;

  const ctx = {
    product,
    title,
    specText,
    hasSpecText: specText.trim().length > 0,

    attr(keyRegex) {
      const hits = attributes.filter(a => keyRegex.test(a.key)).map(a => a.val);
      return hits.length ? hits.join(' · ') : null;
    },
    attrKeyName(keyRegex) {
      const hit = attributes.find(a => keyRegex.test(a.key));
      return hit ? hit.key : 'attribute';
    },
    structured(path) {
      return product.structured ? getPath(product.structured, path) : undefined;
    },
    db(slug) {
      if (!product.dbAttributes) return null;
      const v = product.dbAttributes[slug];
      return v === undefined ? null : v;
    },

    // Spec text is more specific than the title, so it is read first and the
    // title only fills what the specs leave out.
    get memory() {
      if (!memory) {
        const fromSpecs = parseMemory(specText);
        const fromTitle = parseMemory(title);
        memory = {
          ramGb: fromSpecs.ramGb ?? fromTitle.ramGb,
          storageGb: fromSpecs.storageGb ?? fromTitle.storageGb,
          inferred: {
            ramGb: fromSpecs.ramGb !== null ? fromSpecs.inferred.ramGb : fromTitle.inferred.ramGb,
            storageGb: fromSpecs.storageGb !== null ? fromSpecs.inferred.storageGb : fromTitle.inferred.storageGb
          },
          source: fromSpecs.ramGb !== null || fromSpecs.storageGb !== null ? 'text' : 'title'
        };
      }
      return memory;
    },
    get chip() {
      if (chip === undefined) {
        const processor = ctx.structured('performance.processor');
        chip = lookupChip(typeof processor === 'string' ? processor : null)
          || lookupChip(specText)
          || lookupChip(title);
      }
      return chip;
    }
  };
  return ctx;
}

function extract(product, profile) {
  const ctx = buildContext(product);
  const out = {};
  for (const d of profile) {
    let r = null;
    try {
      r = d.extract(ctx);
    } catch (_) {
      r = null; // a parser bug on one dimension must not sink the comparison
    }
    if (!r || r.value === null || r.value === undefined || (typeof r.value === 'number' && !Number.isFinite(r.value))) {
      out[d.key] = null;
      continue;
    }
    out[d.key] = {
      value: r.value,
      display: r.display !== undefined ? r.display : null,
      unit: d.unit,
      source: r.source,
      confidence: r.confidence,
      meta: r.meta || null
    };
  }
  return out;
}

module.exports = { extract, buildContext };
