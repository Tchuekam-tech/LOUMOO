/**
 * LOUMOO Store Domain — The house store (NanoAfrica) and its delivery agency (nanoDelivery)
 * ---------------------------------------------------------------------------
 * The storefront ships a curated catalogue (src/data/catalog_products.js) that has
 * no seller account behind it. Until a real seller lists their own goods, every one
 * of those products belongs to the platform owner's store, NanoAfrica, and is
 * delivered by the owner's agency, nanoDelivery.
 *
 * The ids are DETERMINISTIC on purpose. The static catalogue dataset, the server
 * and the frontend all need to name the same store without a lookup, and a
 * provisioning script must be safe to run twice. What is NOT fixed here is the
 * owner: the owner's account is whoever `iam.stores.owner_id` names for this row,
 * written by the provisioning script and read back at runtime. Nothing in this
 * file (or in any request) can nominate a seller.
 */
'use strict';

const HOUSE_STORE = Object.freeze({
  id: 'store_nanoafrica',
  slug: 'nanoafrica',
  name: 'NanoAfrica'
});

const HOUSE_AGENCY = Object.freeze({
  organizationId: 'org_nanodelivery',
  slug: 'nanodelivery',
  name: 'nanoDelivery'
});

function isHouseStoreId(storeId) {
  return storeId === HOUSE_STORE.id;
}

module.exports = { HOUSE_STORE, HOUSE_AGENCY, isHouseStoreId };
