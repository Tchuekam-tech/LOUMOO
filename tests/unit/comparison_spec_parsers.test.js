/**
 * LOUMOO Unit Tests — Comparison v2 spec parsers (French/English free text).
 * Every case below is a string taken from the live catalogue.
 */

require('../setup');
const assert = require('assert');
const P = require('../../server/modules/catalog/domain/comparison/specParsers');

async function run() {
  console.log('  Testing comparison spec parsers on catalogue strings...');

  // Numbers in French notation
  assert.strictEqual(P.parseNumberFr('1.035.000'), 1035000);
  assert.strictEqual(P.parseNumberFr('1 035 000'), 1035000);
  assert.strictEqual(P.parseNumberFr('13,6'), 13.6);
  assert.strictEqual(P.parseNumberFr('13.6'), 13.6);
  assert.strictEqual(P.parseNumberFr(''), null);
  assert.strictEqual(P.parseNumberFr(null), null);

  // Memory: RAM vs storage vs graphics memory
  const tensor = P.parseMemory('Puce Google Tensor G3 · 12GB LPDDR5X · 128GB UFS 3.1 · 50MP Triple Cam');
  assert.strictEqual(tensor.ramGb, 12);
  assert.strictEqual(tensor.storageGb, 128);
  assert.strictEqual(tensor.inferred.ramGb, false);

  const gaming = P.parseMemory('Intel Core i7-13700H · RTX 4060 8GB · 32GB RAM · 1TB SSD · Châssis aluminium CNC');
  assert.strictEqual(gaming.ramGb, 32, 'GPU memory (RTX 4060 8GB) is not system RAM');
  assert.strictEqual(gaming.storageGb, 1024, '1TB normalises to 1024 GB');

  const title = P.parseMemory('Apple MacBook Air M2 13.6 pouces Minuit (8GB RAM / 256GB SSD) (Configuration Pro #1)');
  assert.deepStrictEqual([title.ramGb, title.storageGb], [8, 256]);

  const bare = P.parseMemory('Apple iPhone 15 128GB Noir Minuit');
  assert.strictEqual(bare.ramGb, null, 'Unknown RAM stays unknown');
  assert.strictEqual(bare.storageGb, 128);
  assert.strictEqual(bare.inferred.storageGb, true, 'Bare capacity is flagged as inferred');

  const unified = P.parseMemory('Mémoire: 8GB mémoire unifiée ultra rapide');
  assert.strictEqual(unified.ramGb, 8);
  assert.strictEqual(unified.storageGb, null);

  // Battery and charging
  assert.strictEqual(P.parseMah('Capacité 30 000 mAh · 4 câbles intégrés'), 30000);
  assert.strictEqual(P.parseMah('5100 mAh Charge Rapide'), 5100);
  assert.strictEqual(P.parseMah('Charge rapide'), null);
  assert.strictEqual(P.parseWatts('200MP OIS · 120W HyperCharge · IP68'), 120);
  assert.strictEqual(P.parseWatts('52.6 Wh Lithium-Polymer'), null, 'Wh is energy, not power');
  assert.strictEqual(P.parseRmsWatts('60W RMS Class D Amplifier'), 60);
  assert.strictEqual(P.parseHours("Jusqu'à 18h d'utilisation continue"), 18);
  assert.strictEqual(P.parseHours('Transducteurs 10mm dynamiques · Autonomie 35h avec boîtier'), 35);
  assert.strictEqual(P.parseHours('20 heures d\'écoute continue'), 20);

  // Display
  assert.strictEqual(P.parseRefreshHz('Dynamic AMOLED 3X 1-144Hz variable'), 144);
  assert.strictEqual(P.parseInches('Écran: 6.78" FHD+ AMOLED 120Hz'), 6.78);
  assert.strictEqual(P.parseInches('Écran Liquid Retina 13.6 pouces'), 13.6);
  assert.strictEqual(P.parseNits('Super Actua OLED 6.8" 1-120Hz 3000 nits'), 3000);

  // Camera
  assert.strictEqual(P.parseMegapixels('200MP Quad Telephoto · 12MP'), 200);
  assert.strictEqual(P.parseOpticalZoom('Téléobjectif 5x optique'), 5);
  assert.strictEqual(P.parseOpticalZoom('Zoom 100x Space Zoom'), null, 'Digital zoom is not optical zoom');

  // Physical / commerce
  assert.strictEqual(P.parseKg('1.24 kg seulement'), 1.24);
  assert.strictEqual(P.parseKg('Châssis 980 g'), 0.98);
  assert.strictEqual(P.parseWarrantyMonths("24 Mois pièces et main d'œuvre"), 24);
  assert.strictEqual(P.parseWarrantyMonths('Garantie 2 ans'), 24);
  assert.strictEqual(P.parseWarrantyMonths('Garantie constructeur'), null);
  assert.strictEqual(P.parseIpWater('IPX8 Étanche'), 8);
  assert.strictEqual(P.parseIpWater('Étanchéité IP67'), 7);
  assert.strictEqual(P.parseBluetoothVersion('Bluetooth 5.3 Multipoint'), 5.3);

  // Fashion sizes
  assert.deepStrictEqual(P.parseShoeSizes('Du 38 au 45'), { min: 38, max: 45, count: 8 });
  assert.strictEqual(P.parseLetterSizeCount('Du S au XXL'), 5);
  assert.strictEqual(P.parseLetterSizeCount('S, M, L'), 3);

  // Booleans
  assert.strictEqual(P.hasAnc('50dB Hybrid ANC'), true);
  assert.strictEqual(P.hasAnc('Réduction active du bruit & Audio spatial'), true);
  assert.strictEqual(P.hasAnc('Son 2 voies puissant'), false);
  assert.strictEqual(P.has5g('5G Dual SIM'), true);
  assert.strictEqual(P.hasDedicatedGpu('RTX 4060 8GB'), true);

  console.log('    ✓ Spec parsers passed.');
}

if (require.main === module) {
  run().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
  });
}

module.exports = { run };
