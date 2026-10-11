/**
 * The delivery circuit's own test gate.
 *
 * `npm test` (tests/run_all.js) cannot be relied on for delivery: it runs every suite in
 * one process, and announce_zero_telemetry.test.js calls process.exit(0) when it is
 * loaded, which ends the run after about a dozen suites with a success code. None of the
 * delivery suites sit before that point, so they never ran in CI or in the deploy gate.
 *
 * This runs them for real, in order, in this process, and exits non-zero on the first
 * failure. They need no database and no credentials: orders and deliveries live in
 * memory, and the browser module is exercised in Node.
 *
 *   npm run test:delivery
 */

require('../setup');
const path = require('path');
const { execFileSync } = require('child_process');

const SUITES = [
  'delivery_domain',
  'delivery_repository',
  'delivery_service',
  'delivery_routes',
  'delivery_sweeper',
  'delivery_board',
  'delivery_dispatch',
  'delivery_contact',
  'delivery_circuit',
  // The buyer's tracking screen (browser code, run on a fake DOM): waits for the seller, retries, loads the map early.
  'delivery_tracking_screen',
  'delivery_circuit_e2e',
  'delivery_geocoder',
  'delivery_nudge',
  // Rider presence (docs/DELIVERY_API.md v1.3): who can be offered a delivery right now.
  // The pure rules, the service, dispatch (assign / auto-assign / accept), the races
  // between them, the HTTP routes, the repository, and the client's heartbeat controller.
  'rider_presence_domain',
  'rider_presence_service',
  'rider_presence_dispatch',
  'rider_presence_races',
  'rider_presence_routes',
  'rider_presence_repository',
  'rider_presence_client',
  'shipping_city_rates',
  // The order path in the compiled app: what a buyer does before a delivery can exist.
  'checkout_server_orders',
  // A showcase (curated) product is refused with a 404, never filed under a fake seller.
  'order_showcase_items',
  'checkout_published_notifications_fixes',
  'store_whatsapp_redirect'
];

// Suites that live beside this runner (not in tests/unit, which `npm test` also loads).
const OWN_SUITES = [
  'readiness',   // the operator's read-only readiness check, against a fake database
  'migrations'   // the real migration files on a real Postgres engine (PGlite)
];

(async () => {
  for (const name of SUITES) {
    const suite = require(`../unit/${name}.test`);
    if (!suite || typeof suite.run !== 'function') throw new Error(`${name}.test.js does not export run()`);
    await suite.run();
    console.log(`PASS ${name}`);
  }
  for (const name of OWN_SUITES) {
    const suite = require(`./${name}.test`);
    if (!suite || typeof suite.run !== 'function') throw new Error(`${name}.test.js does not export run()`);
    await suite.run();
    console.log(`PASS ${name}`);
  }
  // The API client's own checks are a script, not a suite: run it as one.
  execFileSync(process.execPath, [path.join(__dirname, '../../src/services/deliveryApi.test.js')], { stdio: 'inherit' });
  console.log(`PASS delivery: ${SUITES.length + OWN_SUITES.length} suites and the API client checks`);
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
