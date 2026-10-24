/**
 * LOUMOO - a small emulator of how Vercel serves a static build with vercel.json
 * ---------------------------------------------------------------------------
 * Lets the tests ask "what would the host answer for this URL?" using the REAL
 * vercel.json and the REAL publish directory (public/), without a network or an
 * account. It implements the subset the project uses, in Vercel's documented order:
 *
 *   1. trailingSlash:false   '/x/' -> 308 '/x'
 *   2. redirects             first match, 308 for permanent, query string kept; a redirect may be
 *                            conditional on the Host header (has:[{type:'host',value}]), and the
 *                            request's host is get(url, { host }) (default: www.loumoo.store)
 *   3. filesystem            an exact file in the output directory wins over rewrites
 *   4. rewrites              first match; '/api/...' goes to the serverless function
 *   5. no match              404.html (if present) with a 404 status, otherwise a bare 404
 *
 * Path patterns are the path-to-regexp subset vercel.json here uses: literal
 * segments, ':name', ':name(regex)' and '(.*)'.
 *
 * It is deliberately strict about what it does not support: an unknown construct
 * throws, so the config cannot quietly start relying on behaviour the tests do not model.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function compileSource(source) {
  let i = 0;
  let re = '';
  const names = [];
  while (i < source.length) {
    const c = source[i];
    if (c === ':') {
      const m = /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(i));
      if (!m) throw new Error(`vercelEmulator: bad parameter in ${source}`);
      i += m[0].length;
      names.push(m[1]);
      if (source[i] === '(') {
        const end = matchParen(source, i);
        re += '(' + source.slice(i + 1, end) + ')';
        i = end + 1;
      } else {
        re += '([^/]+)';
      }
    } else if (c === '(') {
      const end = matchParen(source, i);
      re += '(' + source.slice(i + 1, end) + ')';
      names.push(String(names.length));
      i = end + 1;
    } else if ('*+?{}|\\'.includes(c)) {
      throw new Error(`vercelEmulator: unsupported pattern character '${c}' in ${source}`);
    } else {
      re += c.replace(/[.^$()[\]]/g, '\\$&');
      i += 1;
    }
  }
  return { re: new RegExp('^' + re + '/?$'), names };
}

function matchParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '[') { while (i < s.length && s[i] !== ']') { if (s[i] === '\\') i++; i++; } continue; }
    if (s[i] === '(') depth++;
    if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  throw new Error(`vercelEmulator: unbalanced parenthesis in ${s}`);
}

const DEFAULT_HOST = 'www.loumoo.store';

function createEmulator({ config, outputDir }) {
  const redirects = (config.redirects || []).map(r => ({ ...r, c: compileSource(r.source) }));
  const rewrites = (config.rewrites || []).map(r => ({ ...r, c: compileSource(r.source) }));
  // The one condition the config uses: a REDIRECT that applies to one Host (the apex -> the canonical
  // host). Header, cookie and query conditions, `missing`, and a conditional rewrite are not modelled, so
  // they throw instead of quietly being treated as unconditional.
  redirects.forEach(r => {
    if (r.missing) throw new Error(`vercelEmulator: 'missing' is not supported (redirect ${r.source})`);
    (r.has || []).forEach(h => {
      if (h.type !== 'host' || typeof h.value !== 'string') throw new Error(`vercelEmulator: only has:{type:'host'} is supported (redirect ${r.source})`);
    });
  });
  rewrites.forEach(r => {
    if (r.has || r.missing) throw new Error(`vercelEmulator: a conditional rewrite is not supported (${r.source})`);
  });
  const hostMatches = (item, host) => !item.has || item.has.every(h => new RegExp('^(?:' + h.value + ')$', 'i').test(host));
  const fileAt = (p) => {
    let decoded;
    try { decoded = decodeURIComponent(p); } catch (e) { return null; }
    if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;
    const full = path.join(outputDir, decoded);
    if (!full.startsWith(outputDir)) return null;
    try { return fs.statSync(full).isFile() ? full : null; } catch (e) { return null; }
  };
  const matchAny = (list, pathname, host) => {
    // Vercel matches the request path as received (percent-encoded) and its decoded form.
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch (e) { /* keep raw */ }
    for (const item of list) {
      if (!hostMatches(item, host)) continue;
      const m = item.c.re.exec(pathname) || item.c.re.exec(decoded);
      if (m) return Object.assign({}, item, { groups: m.slice(1) });
    }
    return null;
  };
  // ':id' in a destination is replaced by what the source captured, and '$1' by the first unnamed
  // capture ('/(.*)'), as Vercel does.
  const fill = (dest, item) => dest
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (all, n) => {
      const i = item.c.names.indexOf(n);
      return i === -1 ? all : item.groups[i];
    })
    .replace(/\$(\d+)/g, (all, n) => (item.groups[Number(n) - 1] === undefined ? all : item.groups[Number(n) - 1]));

  /**
   * @param {string} url  path and query, as requested
   * @param {{host?:string}} [request]  the Host header (default: the canonical host)
   * @returns {{status:number, via:string, file?:string, location?:string, destination?:string}}
   */
  function get(url, request) {
    const host = (request && request.host) || DEFAULT_HOST;
    const q = url.indexOf('?');
    let pathname = q === -1 ? url : url.slice(0, q);
    const search = q === -1 ? '' : url.slice(q);

    if (config.trailingSlash === false && pathname.length > 1 && pathname.endsWith('/')) {
      return { status: 308, via: 'trailing-slash', location: pathname.replace(/\/+$/, '') + search };
    }
    const red = matchAny(redirects, pathname, host);
    if (red) {
      return { status: red.permanent === false ? 307 : 308, via: 'redirect', location: fill(red.destination, red) + search };
    }
    if (pathname === '/') pathname = '/index.html';
    const file = fileAt(pathname);
    if (file) return { status: 200, via: 'static', file };
    const rw = matchAny(rewrites, pathname, host);
    if (rw) {
      if (rw.destination.startsWith('/api/')) return { status: 200, via: 'function', destination: rw.destination };
      const dest = fileAt(rw.destination);
      if (!dest) return { status: 404, via: 'rewrite-target-missing', destination: rw.destination };
      return { status: 200, via: 'rewrite', file: dest, destination: rw.destination };
    }
    const notFound = fileAt('/404.html');
    return notFound ? { status: 404, via: '404.html', file: notFound } : { status: 404, via: 'bare-404' };
  }

  return { get };
}

module.exports = { createEmulator, compileSource };
