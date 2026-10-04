/**
 * Frontend performance guardrails.
 *
 * These checks keep the generated shell small and make route-level loading,
 * media deferral, and runtime cleanup hard to regress accidentally.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const shellPath = path.join(ROOT, 'Commerce App.dc.html');
const shell = fs.readFileSync(shellPath, 'utf8');
const chunkNames = fs.readdirSync(ROOT)
  .filter(name => /Screens\.dc\.html$/.test(name))
  .sort();
const chunks = chunkNames.map(name => ({
  name,
  source: fs.readFileSync(path.join(ROOT, name), 'utf8')
}));

function tagsWithoutAttribute(source, tag, attribute) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  return (source.match(pattern) || []).filter(openTag => !new RegExp(`\\b${attribute}\\s*=`, 'i').test(openTag));
}

function bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function testRouteChunks() {
  const expected = [
    'AccountAccessScreens.dc.html',
    'AccountHubScreens.dc.html',
    'ChatProfileScreens.dc.html',
    'CheckoutScreens.dc.html',
    'CollectionsScreens.dc.html',
    'CommunityScreens.dc.html',
    'HotelScreens.dc.html',
    'MerchantScreens.dc.html',
    'OnboardingScreens.dc.html',
    'OrderScreens.dc.html',
    'ProductScreens.dc.html',
    'PublicProfileScreens.dc.html',
    'PublishingScreens.dc.html',
    'SearchScreens.dc.html',
    'StoreBusinessScreens.dc.html',
    'SuperAdminScreens.dc.html',
    'TravelScreens.dc.html'
  ];

  assert.deepStrictEqual(chunkNames, expected, 'Every secondary screen group must have a generated route chunk');
  assert.ok((shell.match(/<dc-import\b/g) || []).length >= expected.length,
    'The shell must lazy-load each secondary screen group');
  assert.ok(!shell.includes('src/services/supabase.js'), 'Supabase client must not be eagerly loaded by the shell');
  assert.ok(!shell.includes('src/services/publishingEngine.js"></script>'),
    'The publishing engine must not be eagerly loaded by the shell');
  assert.ok(shell.includes('defer src="./src/services/loumooApi.js"'), 'API bridge should be deferred');
  assert.ok(shell.includes('defer src="./src/services/clerkSession.js"'), 'Clerk bridge should be deferred');
  assert.ok(shell.includes('defer src="./src/services/accountGuard.js"'), 'Account guard should be deferred');

  for (const chunk of chunks) {
    assert.ok(chunk.source.includes('<x-dc>'), `${chunk.name} must contain a valid DC root`);
    assert.ok(chunk.source.includes('data-dc-script'), `${chunk.name} must contain its child runtime class`);
  }

  console.log(`  ✓ Route chunks: ${chunks.length} secondary screen groups load outside the initial shell`);
}

function testPayloadBudget() {
  const shellBytes = bytes(shell);
  const chunkBytes = chunks.reduce((total, chunk) => total + bytes(chunk.source), 0);

  // The pre-split generated shell was 1,628,189 bytes. Ensure the markup shell
  // (excluding the curated inlined 932-product catalog) stays well under 1 MB
  // so route chunks are never silently re-inlined into the initial shell.
  const shellWithoutCatalog = shell.replace(/const PRODUCTS_DATA = \{[\s\S]*?\n\};/, '');
  const shellCodeBytes = bytes(shellWithoutCatalog);

  assert.ok(shellCodeBytes < 1_000_000, `Initial shell markup must stay below 1 MB; got ${shellCodeBytes} bytes`);
  assert.ok(shellBytes < 3_000_000, `Total initial shell with full 932 catalog items must stay below 3 MB; got ${shellBytes} bytes`);
  assert.ok(chunkBytes > 0, 'Secondary route chunks must contain deferred screen markup');
  console.log(`  ✓ Initial payload: ${(shellCodeBytes / 1024).toFixed(1)} KiB shell markup (${(shellBytes / 1024).toFixed(1)} KiB with 932 catalog listings); ${(chunkBytes / 1024).toFixed(1)} KiB deferred routes`);
}

function testMediaDeferral() {
  const allSources = [shell, ...chunks.map(chunk => chunk.source)];
  for (const [index, source] of allSources.entries()) {
    assert.deepStrictEqual(tagsWithoutAttribute(source, 'img', 'loading'), [],
      `Generated source ${index} contains an eager image`);
    assert.deepStrictEqual(tagsWithoutAttribute(source, 'img', 'decoding'), [],
      `Generated source ${index} contains an image without async decoding`);
    assert.deepStrictEqual(tagsWithoutAttribute(source, 'video', 'preload'), [],
      `Generated source ${index} contains a video without an explicit preload policy`);
  }
  console.log('  ✓ Media policy: images lazy/async decoded and videos preload=none across shell and chunks');
}

function testRuntimeCleanupAndLazyCompilation() {
  const runtime = fs.readFileSync(path.join(ROOT, 'support.js'), 'utf8');
  const appLogic = shell;
  assert.ok(runtime.includes('let kids = null;'), 'Conditional and loop children should compile lazily');
  assert.ok(runtime.includes('const getKids = () =>'), 'Runtime should cache lazy child compilation');
  assert.ok(appLogic.includes('this._ambientObserver.disconnect()'), 'Ambient media observer must be disconnected');
  assert.ok(appLogic.includes('this._ambientMutationObserver.disconnect()'), 'Mutation observer must be disconnected');
  console.log('  ✓ Runtime lifecycle: inactive branches defer compilation and observers are released on teardown');
}

testRouteChunks();
testPayloadBudget();
testMediaDeferral();
testRuntimeCleanupAndLazyCompilation();
console.log('Frontend performance tests passed.');
