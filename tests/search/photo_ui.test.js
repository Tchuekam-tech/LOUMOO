// Real Chromium, real canvas: the photo shrink as a browser runs it, checked
// against the server's own image validator. Fake kits (photo.test.js) prove the
// logic; this proves the browser primitives behave the way that logic assumes.
require('../setup');
const assert = require('node:assert/strict'),
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
        return [img.naturalWidth, img.naturalHeight, plain.length];
      };
      return {
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
    assert.ok(Math.abs(tw / th - 2 / 3) < 0.01, `tagged keeps 2:3 (${tw}x${th})`);
    assert.ok(pw > ph, `untagged control stays landscape (${pw}x${ph})`);

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
    console.log(
      'PASS photo in Chromium: oversize photo shrunk under the server limit and accepted by its validator, small file untouched, EXIF rotation kept, transparency flattened to white',
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
