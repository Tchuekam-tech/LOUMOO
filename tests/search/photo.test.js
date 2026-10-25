const assert = require('node:assert/strict'),
  Search = require('../../src/services/searchExperience');
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

module.exports = async () => {
  await passThrough();
  await ladder();
  console.log(
    'PASS photo: untouched under the limit; size and quality ladder, orientation, no upscaling',
  );
};
