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
  serverContract();
  console.log(
    'PASS photo: untouched under the limit; size and quality ladder, orientation, no upscaling, failures end in a plain message, budget matches the server validator',
  );
};
