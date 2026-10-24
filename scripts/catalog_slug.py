#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LOUMOO catalogue slugs for the Python catalogue generators.

The same algorithm as server/modules/catalog/domain/ProductSlug.js, which is the
reference (read its header for the why). tests/unit/product_slug.test.js runs both over
the whole seed catalogue and fails if a single slug differs.

    slug = <whole words of the title, at most 56 characters>-<4 characters>

    - the 4 characters are a hash of the product's IMMUTABLE id, so the same product has
      the same slug on every run, and no other product can change it;
    - the title is cut between words, never inside one;
    - there is NO counter: an id that is already taken is a generator bug (raise), not
      something to fix by appending "_2", "_3" ... "_26" (that minted a new URL on every
      rebuild and put 26 copies of one phone in the sitemap).

    python scripts/catalog_slug.py --check [data/catalog.json]
        recompute every product's slug and compare it with the `slug` stored in the file
"""

import hashlib
import json
import re
import sys
import unicodedata

MAX_BASE_LENGTH = 56
SUFFIX_LENGTH = 4
ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
SUFFIX_SPACE = len(ALPHABET) ** SUFFIX_LENGTH
FALLBACK_BASE = 'product'
# The router accepts [A-Za-z0-9_-]{1,128}; an id past it would be a page nobody can open.
MAX_ID_LENGTH = 128

# "(#11)", "(Configuration Pro #11)" at the end of a title: a generator counter, not part of the product.
COUNTER_MARKER = re.compile(r'\s*\([^()]*#\d+\)\s*$')
LIGATURES = {'œ': 'oe', 'æ': 'ae', 'ß': 'ss'}


def strip_counter_marker(title):
    return COUNTER_MARKER.sub('', '' if title is None else str(title)).strip()


def _fold(text):
    text = unicodedata.normalize('NFKD', '' if text is None else str(text))
    text = re.sub('[̀-ͯ]', '', text).lower()
    text = re.sub('[œæß]', lambda m: LIGATURES[m.group(0)], text)
    return re.sub("['’]", '', text)


def to_words(text):
    """Whitespace-separated words, each as it appears in a slug ("Slip-On" -> "slip-on")."""
    words = []
    for part in re.split(r'\s+', _fold(text)):
        pieces = re.findall('[a-z0-9]+', part)
        if pieces:
            words.append('-'.join(pieces))
    return words


def truncate_on_word_boundary(words, limit=MAX_BASE_LENGTH):
    kept = []
    length = 0
    for word in words:
        nxt = length + (1 if kept else 0) + len(word)
        if kept and nxt > limit:
            break
        kept.append(word)
        length = nxt
    return '-'.join(kept)


def stable_suffix(immutable_id):
    ident = '' if immutable_id is None else str(immutable_id)
    if not ident:
        raise ValueError("a slug suffix needs the product's immutable id")
    n = int.from_bytes(hashlib.sha256(ident.encode('utf-8')).digest()[:4], 'big') % SUFFIX_SPACE
    out = ''
    for _ in range(SUFFIX_LENGTH):
        out = ALPHABET[n % len(ALPHABET)] + out
        n //= len(ALPHABET)
    return out


def product_slug(title, immutable_id):
    base = truncate_on_word_boundary(to_words(strip_counter_marker(title))) or FALLBACK_BASE
    return base + '-' + stable_suffix(immutable_id)


def immutable_id(text):
    """
    The id a generator gives a product: the whole text as lower-case ASCII words joined by
    '_', never truncated. A generator includes the product's index in `text`, so the id is
    unique by construction and does not depend on what else was generated.
    """
    ident = '_'.join(re.findall('[a-z0-9]+', _fold(text)))
    if not ident:
        raise ValueError('cannot make an id from %r' % (text,))
    if len(ident) > MAX_ID_LENGTH:
        raise ValueError('id is %d characters, the router accepts %d: %s' % (len(ident), MAX_ID_LENGTH, ident))
    return ident


def claim_id(used_ids, pid):
    """Reserve `pid`. A repeat is a bug in the generator's input, never fixed with a counter."""
    if pid in used_ids:
        raise ValueError('duplicate product id %r: the generator produced it twice' % (pid,))
    used_ids.add(pid)
    return pid


def _check(path):
    with open(path, 'r', encoding='utf-8') as handle:
        catalog = json.load(handle)
    bad = []
    for pid, product in catalog.items():
        want = product_slug(product.get('title'), pid)
        if product.get('slug') != want:
            bad.append((pid, product.get('slug'), want))
    seen = {}
    for pid, product in catalog.items():
        seen.setdefault(product.get('slug'), []).append(pid)
    dupes = {slug: ids for slug, ids in seen.items() if len(ids) > 1}
    for pid, have, want in bad[:10]:
        print('MISMATCH %s: has %r, algorithm gives %r' % (pid, have, want))
    for slug, ids in list(dupes.items())[:10]:
        print('DUPLICATE slug %s: %s' % (slug, ids))
    print('%d products, %d mismatched, %d duplicated slugs' % (len(catalog), len(bad), len(dupes)))
    return 0 if not bad and not dupes else 1


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == '--check':
        sys.exit(_check(sys.argv[2] if len(sys.argv) > 2 else 'data/catalog.json'))
    print(__doc__)
