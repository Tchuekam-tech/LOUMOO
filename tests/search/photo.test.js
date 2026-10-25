const assert = require('node:assert/strict'),
  Search = require('../../src/services/searchExperience'),
  {
    validateImage,
  } = require('../../server/modules/search/infrastructure/SearchAI');
const { PHOTO, preparePhoto } = Search;

// A stand-in for the browser. The "photo" is just a width x height, and the JPEG
// a canvas would make of it is bytesPerPixel * pixels * quality, which steers
// preparePhoto down its ladder deterministically. `log` records what it did.
function fakeKit({
  width = 4000,
  height = 3000,
  bytesPerPixel = 0.8,
  decodeError,
  drawError,
  blobFor,
} = {}) {
  const log = {
    decoded: 0,
    closed: 0,
    drawn: 0,
    released: 0,
    attempts: [],
    read: [],
  };
  return {
    log,
    decode: async () => {
      log.decoded++;
      if (decodeError) throw decodeError;
      return { width, height, close: () => log.closed++ };
    },
    draw: (img, w, h) => {
      if (drawError) throw drawError;
      log.drawn++;
      return {
        blob: async (q) => {
          log.attempts.push([w, h, q]);
          return blobFor
            ? blobFor(w, h, q)
            : { size: Math.round(w * h * q * bytesPerPixel) };
        },
        release: () => log.released++,
      };
    },
    read: async (b) => {
      log.read.push(b);
      return `data:image/jpeg;base64,${b.size}`;
    },
  };
}
const file = (size) => ({ name: 'photo.jpg', type: 'image/jpeg', size });
// Every canvas drawn is released and the decoded image is closed exactly once.
const tidy = (log) => {
  assert.equal(log.released, log.drawn);
  assert.equal(log.closed, log.decoded);
};

async function passThrough() {
  // Inside the server limit the picked file goes up untouched: nothing is
  // decoded, drawn or re-encoded, so a small photo keeps its exact bytes.
  for (const size of [1, 500000, PHOTO.serverBytes]) {
    const kit = fakeKit(),
      picked = file(size);
    assert.equal(
      await preparePhoto(picked, kit),
      `data:image/jpeg;base64,${size}`,
    );
    assert.equal(kit.log.read[0], picked);
    assert.equal(kit.log.decoded, 0);
    assert.equal(kit.log.drawn, 0);
  }
  // One byte over and it is shrunk instead.
  const kit = fakeKit();
  await preparePhoto(file(PHOTO.serverBytes + 1), kit);
  assert.equal(kit.log.decoded, 1);
  assert.notEqual(kit.log.read[0].size, PHOTO.serverBytes + 1);
}

async function ladder() {
  // 4000x3000 -> longest side 1280. The first quality is too big for the
  // target, the second fits, and that is the one that is sent.
  let kit = fakeKit({ bytesPerPixel: 0.8 });
  assert.equal(
    await preparePhoto(file(6e6), kit),
    'data:image/jpeg;base64,688128',
  );
  assert.deepEqual(kit.log.attempts, [
    [1280, 960, 0.85],
    [1280, 960, 0.7],
  ]);
  tidy(kit.log);

  // A dense picture steps down through every quality, then to smaller sizes,
  // and stops at the first combination that fits.
  kit = fakeKit({ bytesPerPixel: 3 });
  assert.equal(
    await preparePhoto(file(6e6), kit),
    'data:image/jpeg;base64,641520',
  );
  assert.deepEqual(
    kit.log.attempts.map(([w, h]) => `${w}x${h}`),
    [
      ...Array(4).fill('1280x960'),
      ...Array(4).fill('960x720'),
      ...Array(3).fill('720x540'),
    ],
  );
  assert.deepEqual(
    kit.log.attempts.slice(0, 4).map((a) => a[2]),
    PHOTO.qualities,
  );
  tidy(kit.log);

  // A portrait photo keeps its shape: the long side is the height.
  kit = fakeKit({ width: 3000, height: 4000 });
  await preparePhoto(file(6e6), kit);
  assert.deepEqual(kit.log.attempts[0], [960, 1280, 0.85]);

  // A heavy but small picture (a big PNG screenshot) is never scaled up.
  kit = fakeKit({ width: 900, height: 600 });
  await preparePhoto(file(3e6), kit);
  assert.deepEqual(kit.log.attempts, [[900, 600, 0.85]]);

  // A small picture that nothing shrinks enough does not repeat its native size
  // at every edge: it is tried once, then each genuinely smaller size.
  kit = fakeKit({ width: 900, height: 600, bytesPerPixel: 1000 });
  await assert.rejects(preparePhoto(file(3e6), kit), /shrink/);
  assert.deepEqual(
    [...new Set(kit.log.attempts.map(([w, h]) => `${w}x${h}`))],
    ['900x600', '720x480', '540x360', '400x267'],
  );
  assert.equal(kit.log.attempts.length, 4 * PHOTO.qualities.length);
  tidy(kit.log);

  // A sliver never rounds down to zero pixels.
  kit = fakeKit({ width: 1, height: 5000 });
  await preparePhoto(file(3e6), kit);
  assert.deepEqual(kit.log.attempts[0], [1, 1280, 0.85]);
  tidy(kit.log);
}

async function failures() {
  const unreadable = 'Could not read this image.',
    tooBig =
      'We could not shrink this photo enough to send it. Try another one.';

  // The browser cannot decode it.
  let boom = new Error('EncodingError'),
    kit = fakeKit({ decodeError: boom });
  await assert.rejects(
    preparePhoto(file(6e6), kit),
    (e) => e.message === unreadable && e.cause === boom,
  );
  assert.equal(kit.log.attempts.length, 0);

  // It decodes to nothing.
  kit = fakeKit({ width: 0, height: 0 });
  await assert.rejects(preparePhoto(file(6e6), kit), { message: unreadable });
  tidy(kit.log);

  // Nothing fits: every size and every quality is tried, then a plain message.
  kit = fakeKit({ bytesPerPixel: 1000 });
  await assert.rejects(preparePhoto(file(6e6), kit), { message: tooBig });
  assert.equal(
    kit.log.attempts.length,
    PHOTO.edges.length * PHOTO.qualities.length,
  );
  tidy(kit.log);

  // toBlob can hand back null or an empty blob; that is a miss, not a crash.
  kit = fakeKit({ blobFor: (w, h, q) => (q > 0.5 ? null : { size: 0 }) });
  await assert.rejects(preparePhoto(file(6e6), kit), { message: tooBig });
  tidy(kit.log);
  kit = fakeKit({ blobFor: (w, h, q) => (q === 0.85 ? null : { size: 1000 }) });
  assert.equal(
    await preparePhoto(file(6e6), kit),
    'data:image/jpeg;base64,1000',
  );
  assert.deepEqual(
    kit.log.attempts.map((a) => a[2]),
    [0.85, 0.7],
  );
  tidy(kit.log);

  // The canvas itself fails (no 2d context, out of memory).
  boom = new TypeError('no context');
  kit = fakeKit({ drawError: boom });
  await assert.rejects(
    preparePhoto(file(6e6), kit),
    (e) => e.message === tooBig && e.cause === boom,
  );
  tidy(kit.log);

  // Reading the finished JPEG fails.
  boom = new Error('read failed');
  kit = fakeKit();
  const log = kit.log;
  kit.read = async () => {
    throw boom;
  };
  await assert.rejects(
    preparePhoto(file(6e6), kit),
    (e) => e.message === tooBig && e.cause === boom,
  );
  tidy(log);
}

const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
// A controller whose only collaborators are fakes. `calls` is every request the
// photo handler made to the API; `prepared` is every file it asked to shrink.
function controller({ visual = true, prepare } = {}) {
  const calls = [],
    prepared = [];
  const c = new Search({
    api: {
      searchCapabilities: async () => ({ text: true, visual }),
      searchVisual: async (body, signal) => {
        calls.push({ body, signal });
        return {
          items: [{ id: 'bag', title: 'Bag' }],
          message: 'Possible bags',
        };
      },
    },
    preparePhoto:
      prepare ||
      (async (f) => {
        prepared.push(f);
        return 'data:image/jpeg;base64,SMALL';
      }),
  });
  return { c, calls, prepared };
}
const pick = (f) => ({
  target: { files: [f], value: 'C:\\fakepath\\' + f.name },
});

async function handler() {
  // A 6 MB phone photo used to be refused outright. Now it is shrunk and the
  // shrunk copy is what is previewed and sent.
  let { c, calls, prepared } = controller();
  const e = pick({ name: 'IMG_1.jpg', type: 'image/jpeg', size: 6e6 });
  await c.photo(e);
  assert.equal(prepared.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.imageData, 'data:image/jpeg;base64,SMALL');
  assert.equal(c.d.visualPreview, 'data:image/jpeg;base64,SMALL');
  assert.equal(c.d.visualItems[0].id, 'bag');
  assert.equal(c.d.visualError, '');
  assert.equal(c.d.visualBusy, false);
  assert.equal(e.target.value, '', 'the same photo can be picked again');
  c.destroy();

  // What is still refused, before any decoding is attempted.
  const limit = PHOTO.maxInputBytes;
  for (const [f, message] of [
    [
      { name: 'huge.jpg', type: 'image/jpeg', size: limit + 1 },
      'Choose a photo smaller than 25 MB.',
    ],
    [
      { name: 'a.gif', type: 'image/gif', size: 1000 },
      'Choose a JPEG, PNG or WebP photo.',
    ],
    [
      { name: 'unknown', type: '', size: 1000 },
      'Choose a JPEG, PNG or WebP photo.',
    ],
  ]) {
    ({ c, calls, prepared } = controller());
    await c.photo(pick(f));
    assert.equal(c.d.visualError, message, f.name);
    assert.equal(c.d.visualBusy, false);
    assert.equal(prepared.length + calls.length, 0, f.name);
    c.destroy();
  }
  // ...and exactly the cap is fine.
  ({ c, calls } = controller());
  await c.photo(pick({ name: 'edge.jpg', type: 'image/jpeg', size: limit }));
  assert.equal(calls.length, 1);
  c.destroy();

  // No photo search on this deployment: no work is wasted on the photo.
  ({ c, calls, prepared } = controller({ visual: false }));
  await c.photo(pick({ name: 'p.jpg', type: 'image/jpeg', size: 6e6 }));
  assert.equal(
    c.d.visualError,
    'Photo search is unavailable. Please search by typing.',
  );
  assert.equal(prepared.length + calls.length, 0);
  c.destroy();

  // A photo that cannot be shrunk shows the reason and sends nothing.
  ({ c, calls } = controller({
    prepare: async () => {
      throw new Error('We could not shrink this photo enough to send it.');
    },
  }));
  await c.photo(pick({ name: 'p.jpg', type: 'image/jpeg', size: 6e6 }));
  assert.equal(
    c.d.visualError,
    'We could not shrink this photo enough to send it.',
  );
  assert.equal(c.d.visualBusy, false);
  assert.equal(c.d.visualPreview, '');
  assert.equal(calls.length, 0);
  c.destroy();

  // Picking another photo while the first is still being shrunk: only the
  // newer one is searched and shown.
  const first = deferred();
  let n = 0;
  ({ c, calls } = controller({
    prepare: async () =>
      n++ === 0 ? first.promise : 'data:image/jpeg;base64,SECOND',
  }));
  const older = c.photo(pick({ name: '1.jpg', type: 'image/jpeg', size: 6e6 }));
  await tick();
  await c.photo(pick({ name: '2.jpg', type: 'image/jpeg', size: 6e6 }));
  first.resolve('data:image/jpeg;base64,FIRST');
  await older;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.imageData, 'data:image/jpeg;base64,SECOND');
  assert.equal(c.d.visualPreview, 'data:image/jpeg;base64,SECOND');
  c.destroy();

  // Out of the box (no injected shrink) the controller uses the real
  // preparePhoto: a small file is read as picked, a big one is shrunk.
  const kit = Search.photoKit,
    saved = { ...kit },
    fake = fakeKit();
  try {
    Object.assign(kit, {
      decode: fake.decode,
      draw: fake.draw,
      read: fake.read,
    });
    const sent = [];
    const plain = new Search({
      api: {
        searchCapabilities: async () => ({ visual: true }),
        searchVisual: async (body) => {
          sent.push(body.imageData);
          return { items: [], message: '' };
        },
      },
    });
    await plain.photo(pick({ name: 'big.jpg', type: 'image/jpeg', size: 6e6 }));
    await plain.photo(
      pick({ name: 'small.jpg', type: 'image/jpeg', size: 4e5 }),
    );
    assert.deepEqual(sent, [
      'data:image/jpeg;base64,688128',
      'data:image/jpeg;base64,400000',
    ]);
    plain.destroy();
  } finally {
    Object.assign(kit, saved);
  }
}

// The two browser primitives (decode through <img>, draw to a canvas) against a
// recording stand-in for the DOM. Real Chromium covers the behaviour; this pins
// the calls that matter: white before the picture, the quality that was asked
// for, and the object URL being released on every path.
async function primitives() {
  const calls = [],
    realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const ctx = {
    set fillStyle(v) {
      calls.push(['fillStyle', v]);
    },
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    set imageSmoothingQuality(v) {
      calls.push(['smoothing', v]);
    },
    drawImage: (...a) => calls.push(['drawImage', ...a]),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind) => (kind === '2d' ? ctx : null),
    toBlob: (cb, type, q) => {
      calls.push(['toBlob', type, q]);
      cb({ size: 123, type });
    },
  };
  let decodeOutcome = Promise.resolve();
  class FakeImage {
    constructor() {
      FakeImage.last = this;
    }
    set src(v) {
      calls.push(['src', v]);
    }
    decode() {
      return decodeOutcome;
    }
    get naturalWidth() {
      return 800;
    }
    get naturalHeight() {
      return 600;
    }
  }
  globalThis.document = {
    createElement: (tag) => (calls.push(['create', tag]), canvas),
  };
  globalThis.Image = FakeImage;
  URL.createObjectURL = () => 'blob:fake/1';
  URL.revokeObjectURL = (u) => calls.push(['revoke', u]);
  const { decode, draw } = Search.photoKit;
  const revokes = () => calls.filter((c) => c[0] === 'revoke').length;
  try {
    // Decoded through <img>; the URL stays alive until the caller is done.
    const img = await decode({});
    assert.deepEqual(
      [img.width, img.height, calls.find((c) => c[0] === 'src')[1]],
      [800, 600, 'blob:fake/1'],
    );
    assert.equal(revokes(), 0);
    img.close();
    assert.deepEqual(
      calls.filter((c) => c[0] === 'revoke'),
      [['revoke', 'blob:fake/1']],
    );

    // A picture the browser cannot decode: rejected, and the URL released now.
    calls.length = 0;
    const bad = new Error('EncodingError');
    decodeOutcome = Promise.reject(bad);
    await assert.rejects(decode({}), (e) => e === bad);
    assert.equal(revokes(), 1);

    // Without HTMLImageElement.decode(), load events are used instead.
    calls.length = 0;
    FakeImage.prototype.decode = undefined;
    const pending = decode({});
    await tick();
    FakeImage.last.onload();
    assert.equal((await pending).width, 800);
    calls.length = 0;
    const failing = decode({});
    await tick();
    const loadError = new Error('load failed');
    FakeImage.last.onerror(loadError);
    await assert.rejects(failing, (e) => e === loadError);
    assert.equal(revokes(), 1);

    // Drawing: white first, then the picture at the requested size, then JPEG at
    // exactly the quality asked for; release() gives the pixels back.
    calls.length = 0;
    const drawn = draw({ source: 'IMG' }, 640, 480);
    assert.deepEqual(calls, [
      ['create', 'canvas'],
      ['fillStyle', '#fff'],
      ['fillRect', 0, 0, 640, 480],
      ['smoothing', 'high'],
      ['drawImage', 'IMG', 0, 0, 640, 480],
    ]);
    assert.deepEqual([canvas.width, canvas.height], [640, 480]);
    assert.deepEqual(await drawn.blob(0.7), { size: 123, type: 'image/jpeg' });
    assert.deepEqual(calls.at(-1), ['toBlob', 'image/jpeg', 0.7]);
    drawn.release();
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  } finally {
    delete globalThis.document;
    delete globalThis.Image;
    URL.createObjectURL = realUrl.create;
    URL.revokeObjectURL = realUrl.revoke;
  }
}

function serverContract() {
  // The client budget must agree with what the server really accepts. If the
  // server limit or its accepted types ever change, this fails and PHOTO has to
  // follow, instead of photos being shrunk to the wrong size or refused late.
  const data = (type, bytes) =>
    `data:${type};base64,${bytes.toString('base64')}`;
  const jpeg = (size) => {
    const b = Buffer.alloc(size);
    b.set([255, 216, 255]);
    return data('image/jpeg', b);
  };
  assert.ok(PHOTO.targetBytes < PHOTO.serverBytes);
  for (const size of [PHOTO.targetBytes, PHOTO.serverBytes])
    assert.equal(validateImage(jpeg(size)), jpeg(size));
  assert.throws(
    () => validateImage(jpeg(PHOTO.serverBytes + 1)),
    (e) => e.statusCode === 400,
  );
  // Every type the client lets through is a type the server takes.
  const magic = {
    'image/jpeg': Buffer.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    'image/png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
    'image/webp': Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]),
  };
  assert.deepEqual([...PHOTO.types].sort(), Object.keys(magic).sort());
  for (const type of PHOTO.types)
    assert.ok(validateImage(data(type, magic[type])));
  assert.throws(() => validateImage(data('image/gif', Buffer.from('GIF89a'))));
}

module.exports = async () => {
  await passThrough();
  await ladder();
  await failures();
  await handler();
  await primitives();
  serverContract();
  console.log(
    'PASS photo: untouched under the limit; size and quality ladder, orientation, no upscaling, failures end in a plain message, handler wiring, decode/draw primitives, budget matches the server validator',
  );
};
