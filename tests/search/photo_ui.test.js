// Real Chromium, real canvas: the photo shrink as a browser runs it, checked
// against the server's own image validator. Fake kits (photo.test.js) prove the
// logic; this proves the browser primitives behave the way that logic assumes.
require('../setup');
const assert = require('node:assert/strict'),
  express = require('express'),
  path = require('node:path'),
  zlib = require('node:zlib'),
  { chromium } = require('playwright'),
  Search = require('../../src/services/searchExperience'),
  {
    validateImage,
  } = require('../../server/modules/search/infrastructure/SearchAI');
const { PHOTO } = Search;

// A deterministic noise PNG: noise does not compress, so a modest picture is
// comfortably over the 1 MiB the server takes, like a detailed phone photo.
function noisePng(width, height) {
  let s = 0x9e3779b9;
  const row = 1 + width * 3,
    raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++)
    for (let i = 1; i < row; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      raw[y * row + i] = s & 255;
    }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]),
      len = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const bytesOf = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.LOUMOO_BROWSER_PATH || undefined,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.route('http://photo.test/', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>photo</title><input id="f" type="file" accept="image/jpeg,image/png,image/webp">',
      }),
    );
    await page.goto('http://photo.test/');
    await page.addScriptTag({
      path: path.join(__dirname, '../../src/services/searchExperience.js'),
    });
    await page.evaluate(() => {
      window.sent = [];
      window.search = new LoumooSearch({
        api: {
          searchCapabilities: async () => ({ text: true, visual: true }),
          searchVisual: async (body) => {
            window.sent.push(body);
            return { items: [], message: 'ok' };
          },
        },
      });
      document
        .getElementById('f')
        .addEventListener('change', (e) => window.search.photo(e));
    });
    // Natural size of an image given as a data URL, as the browser reads it.
    const dimsOf = (dataUrl) =>
      page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      }, dataUrl);

    // 1. A detailed 3:2 photo picked through the real file chooser.
    const big = noisePng(1200, 800);
    assert.ok(big.length > PHOTO.serverBytes, 'fixture must be over the limit');
    await page.setInputFiles('#f', {
      name: 'IMG_0001.png',
      mimeType: 'image/png',
      buffer: big,
    });
    await page.waitForFunction(() => window.sent.length === 1);
    const { imageData } = await page.evaluate(() => window.sent[0]);
    assert.ok(imageData.startsWith('data:image/jpeg;base64,'));
    assert.ok(
      validateImage(imageData),
      'the server accepts what the browser sent',
    );
    assert.ok(bytesOf(imageData).length <= PHOTO.targetBytes);
    const [w, h] = await dimsOf(imageData);
    assert.ok(Math.max(w, h) <= PHOTO.edges[0], `${w}x${h} within the cap`);
    assert.ok(Math.abs(w / h - 1.5) < 0.01, `${w}x${h} keeps its 3:2 shape`);
    assert.equal(
      await page.evaluate(() => window.search.d.visualPreview),
      imageData,
      'the preview is the copy that was sent',
    );
    assert.equal(await page.inputValue('#f'), '', 'the input is reset');

    // 2. A picture already inside the limit goes up byte for byte.
    const small = noisePng(16, 16);
    assert.ok(small.length < PHOTO.serverBytes);
    await page.setInputFiles('#f', {
      name: 'tiny.png',
      mimeType: 'image/png',
      buffer: small,
    });
    await page.waitForFunction(() => window.sent.length === 2);
    assert.equal(
      (await page.evaluate(() => window.sent[1])).imageData,
      `data:image/png;base64,${small.toString('base64')}`,
    );

    // 3. EXIF rotation. A landscape 3000x2000 JPEG tagged "rotate 90 degrees"
    // is a portrait picture; the copy must come out portrait, not on its side.
    // The untagged twin is the control: it must stay landscape.
    const orientation = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 3000;
      c.height = 2000;
      const ctx = c.getContext('2d'),
        px = ctx.createImageData(c.width, c.height);
      let s = 123456789;
      for (let i = 0; i < px.data.length; i += 4) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        px.data[i] = s & 255;
        px.data[i + 1] = (s >>> 8) & 255;
        px.data[i + 2] = (s >>> 16) & 255;
        px.data[i + 3] = 255;
      }
      ctx.putImageData(px, 0, 0);
      const plain = new Uint8Array(
        await (
          await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95))
        ).arrayBuffer(),
      );
      // APP1/Exif segment: big-endian TIFF, one IFD entry, Orientation (0x0112) = 6.
      const exif = Uint8Array.from([
        0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d,
        0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const tagged = new Uint8Array(plain.length + exif.length);
      tagged.set(plain.subarray(0, 2), 0);
      tagged.set(exif, 2);
      tagged.set(plain.subarray(2), 2 + exif.length);
      const dims = async (file) => {
        const url = await LoumooSearch.preparePhoto(file),
          img = new Image();
        img.src = url;
        await img.decode();
        // The last item: did any EXIF segment (GPS position, device) survive?
        const exifLeft = atob(url.split(',')[1]).includes('Exif');
        return [img.naturalWidth, img.naturalHeight, plain.length, exifLeft];
      };
      return {
        inputHadExif: new TextDecoder('latin1').decode(tagged).includes('Exif'),
        tagged: await dims(
          new File([tagged], 'IMG_ROT.jpg', { type: 'image/jpeg' }),
        ),
        plain: await dims(
          new File([plain], 'IMG_FLAT.jpg', { type: 'image/jpeg' }),
        ),
      };
    });
    assert.ok(orientation.tagged[2] > PHOTO.serverBytes, 'fixture is oversize');
    const [tw, th] = orientation.tagged,
      [pw, ph] = orientation.plain;
    assert.ok(th > tw, `tagged photo is upright (${tw}x${th})`);
    assert.ok(
      Math.abs(tw / th - 2 / 3) < 0.01,
      `tagged keeps 2:3 (${tw}x${th})`,
    );
    assert.ok(pw > ph, `untagged control stays landscape (${pw}x${ph})`);
    assert.equal(orientation.inputHadExif, true, 'fixture carries EXIF');
    assert.equal(orientation.tagged[3], false, 'EXIF is not forwarded');

    // 4. Transparency. JPEG has no alpha, so a transparent area must come out
    // white and not black. The bottom half is noise so the file is oversize.
    const corner = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2400;
      c.height = 1600;
      const ctx = c.getContext('2d'),
        px = ctx.createImageData(c.width, c.height);
      let s = 987654321;
      for (let i = (c.width * c.height * 4) / 2; i < px.data.length; i += 4) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        px.data[i] = s & 255;
        px.data[i + 1] = (s >>> 8) & 255;
        px.data[i + 2] = (s >>> 16) & 255;
        px.data[i + 3] = 255;
      }
      ctx.putImageData(px, 0, 0);
      const png = await new Promise((r) => c.toBlob(r, 'image/png'));
      const url = await LoumooSearch.preparePhoto(
        new File([png], 'cutout.png', { type: 'image/png' }),
      );
      const img = new Image();
      img.src = url;
      await img.decode();
      const out = document.createElement('canvas');
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      const o = out.getContext('2d');
      o.drawImage(img, 0, 0);
      return { size: png.size, pixel: [...o.getImageData(4, 4, 1, 1).data] };
    });
    assert.ok(corner.size > PHOTO.serverBytes, 'fixture is oversize');
    assert.ok(
      corner.pixel.slice(0, 3).every((v) => v >= 250),
      `transparent corner is white, got ${corner.pixel}`,
    );

    // 5. Nothing the page did raised an error.
    assert.deepEqual(errors, []);

    // 6. The real shell under the production security headers: home tile ->
    // photo panel -> pick an oversize photo -> the shrunk copy is searched. The
    // pages above load the controller bare; only this one exercises the shell's
    // template binding, its copy, and the CSP (a blob: image has to decode).
    const app = express();
    app.use(
      require('../../server/shared/middleware/securityHeaders').securityHeaders,
    );
    app.use(express.static(path.join(__dirname, '../..')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const shell = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const shellErrors = [],
        posted = [];
      shell.on('pageerror', (e) => shellErrors.push(e.message));
      shell.on(
        'console',
        (m) =>
          m.type() === 'error' &&
          /Content Security Policy/.test(m.text()) &&
          !/vercel-scripts/.test(m.text()) && // known, unrelated analytics block
          shellErrors.push(m.text()),
      );
      for (const name of ['react', 'react-dom'])
        await shell.route(
          `https://unpkg.com/${name}@18.3.1/umd/${name}.production.min.js`,
          (r) =>
            r.fulfill({
              path: path.join(
                __dirname,
                `../../node_modules/${name}/umd/${name}.production.min.js`,
              ),
              contentType: 'application/javascript',
              headers: { 'Access-Control-Allow-Origin': '*' },
            }),
        );
      const item = {
        id: 'fixture-bag',
        entityType: 'product',
        title: 'Leather handbag fixture',
        price: 'XAF 25 000',
        priceNumeric: 25000,
        storeName: 'Fixture Store',
        merchantCity: 'Douala',
        inStock: null,
        rating: null,
      };
      await shell.route('**/api/**', async (r) => {
        const p = new URL(r.request().url()).pathname;
        let data = {};
        if (p.endsWith('/search/capabilities'))
          data = { text: true, voice: false, assistant: true, visual: true };
        else if (p.endsWith('/search/visual')) {
          posted.push(r.request().postDataJSON());
          data = { items: [item], total: 1, message: 'These look like bags.' };
        } else if (p.endsWith('/search/suggest'))
          data = { items: [item], suggestions: [], total: 1 };
        else if (p.endsWith('/search'))
          data = { items: [item], total: 1, page: 1, limit: 20 };
        else if (p.endsWith('/products')) data = { items: [], total: 0 };
        else if (p.endsWith('/me/state')) data = { authenticated: false };
        else if (p.endsWith('/auth/config')) data = { provider: 'none' };
        await r.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data }),
        });
      });
      await shell.goto(
        `http://127.0.0.1:${server.address().port}/Commerce%20App.dc.html`,
        { waitUntil: 'domcontentloaded' },
      );
      await shell
        .locator('.lsb-search-input')
        .waitFor({ state: 'visible', timeout: 30000 });
      const tile = shell.getByRole('button', { name: /Spatial AI Lens/ });
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      await shell
        .getByRole('heading', { name: 'Search by photo' })
        .waitFor({ state: 'visible', timeout: 15000 });
      assert.equal(
        (
          await shell
            .locator('label', { hasText: 'Choose a photo' })
            .innerText()
        ).trim(),
        `Choose a photo (JPEG, PNG or WebP, up to ${PHOTO.maxInputBytes / 1048576} MB)`,
        'the panel states the real cap (rebuild the shell if this is stale)',
      );
      await shell.setInputFiles('input[type=file]', {
        name: 'IMG_0002.png',
        mimeType: 'image/png',
        buffer: big,
      });
      await shell
        .locator('.search-card')
        .first()
        .waitFor({ state: 'visible', timeout: 20000 });
      assert.equal(posted.length, 1);
      assert.ok(validateImage(posted[0].imageData));
      assert.ok(bytesOf(posted[0].imageData).length <= PHOTO.targetBytes);
      assert.equal(await shell.locator('.search-error').count(), 0);
      assert.equal(
        await shell
          .locator('.search-panel')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        true,
        'no horizontal overflow at 390 px',
      );
      assert.deepEqual(shellErrors, []);
    } finally {
      await new Promise((r) => server.close(r));
    }
    console.log(
      'PASS photo in Chromium: oversize photo shrunk under the server limit and accepted by its validator, small file untouched, EXIF rotation kept, transparency flattened to white, and the real shell sends the shrunk copy under the production CSP',
    );
  } finally {
    await browser?.close();
  }
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
