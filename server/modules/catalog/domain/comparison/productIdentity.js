/**
 * Product identity — which listings are the same product.
 *
 * The curated catalogue lists most products several times ("Google Pixel 8 Pro
 * 128GB Unlocked Android 14" appears 26 times, suffixed "(#4)" or
 * "(Configuration Pro #2)"). Those copies are one product, possibly with several
 * offers. The key ignores seller and price on purpose: the same model sold by two
 * boutiques is one product with two offers, which is exactly what a buyer wants
 * to compare.
 */

// Trailing copy markers: "(#4)", "(Configuration Pro #2)", "#12".
const COPY_SUFFIX = /\s*\((?:[^()]*#\s*\d+)\)\s*$|\s*#\s*\d+\s*$/;

function stripCopyMarker(title) {
  let t = String(title || '').trim();
  // Markers can stack ("... (Edition) (#3)"); strip until none is left.
  for (let i = 0; i < 3 && COPY_SUFFIX.test(t); i++) t = t.replace(COPY_SUFFIX, '').trim();
  return t;
}

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * identityKey({ brand, title }) → stable string.
 * The brand is prepended only when the title does not already start with it, so
 * "Apple iPhone 15" and brand "Apple" + "iPhone 15" agree.
 */
function identityKey(product) {
  const title = fold(stripCopyMarker(product && product.title));
  const brand = fold(product && product.brand);
  if (!title) return `id:${product && product.id}`;
  return brand && !title.startsWith(brand) ? `${brand} ${title}` : title;
}

module.exports = { identityKey, stripCopyMarker };
