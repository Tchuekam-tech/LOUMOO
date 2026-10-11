# NanoAfrica and nanoDelivery

Until real sellers list their own goods, every product in the curated catalogue
(`src/data/catalog_products.js`, loaded by `server/modules/catalog/dataLoader.js`) belongs
to the platform owner: the store **NanoAfrica**, delivered by the agency **nanoDelivery**.
Buyers see NanoAfrica as the seller, the products are orderable, and each order is filed
under the owner's own account so it appears on their order list and dispatch board and
the owner is notified with all the details.

None of this exists until an operator runs the provisioning script once. Until then
nothing changes: a curated product is refused at checkout as a "showcase item", exactly as before.

## How it works

| Piece | Where |
| --- | --- |
| Deterministic ids (`store_nanoafrica`, slug `nanoafrica`, `org_nanodelivery`) | `server/modules/store/domain/HouseStore.js` |
| Read side: finds the store row and its owner | `server/modules/store/application/HouseStoreService.js` (`resolve()`, `resolveDefaultProvider()`) |
| Write side: the provisioning logic | `server/modules/store/application/HouseStoreProvisioner.js` |
| The command | `scripts/provision_nanoafrica.js` |
| Orders: curated id becomes an orderable listing | `server/modules/commerce/infrastructure/OrderRepository.js` (`_findCuratedListing`) |
| Catalogue presents NanoAfrica as the seller | `server/modules/catalog/infrastructure/CatalogRepository.js` |

The rule that keeps this safe: **the seller of an order is always `iam.stores.owner_id` of the
row `store_nanoafrica`.** It is never taken from a request or from the static dataset. If that
row is missing, or the product id is not an *exact* key of the dataset (no slug, no partial
id, no fuzzy match), the product stays un-orderable. The price charged is the payable one: the
lower of `price` and `salePrice` (the higher is the "was" price).

## What the script creates

For the owner account you name (looked up by **verified** email, or by id):

| Table | Row | Notes |
| --- | --- | --- |
| `iam.stores` | `store_nanoafrica` | ACTIVE, PUBLIC, onboarding complete, seller type BRAND, category `general`, verified with tier `official_brand`, phone and email, `product_count` = number of curated products |
| `iam.store_members` | owner of the store | role `owner`, all permissions |
| `iam.store_profiles`, `store_settings`, `store_locations`, `store_hours` | one row each | settings say pay on delivery or pickup, no online payment methods; no "escrow" badge; location is your `--city` (default Douala) and `--street` (empty by default: set the pickup address in Seller Studio) |
| `iam.organizations` | `org_nanodelivery` | type `AGENCY`, same owner |
| `iam.organization_members` | the owner (`OWNER`) and each rider you name (`MEMBER`) | riders in the agency are what lets it hand a delivery to someone |
| `iam.delivery_drivers` | the owner's provider record | display name `nanoDelivery`, `is_agency`, `organization_id = org_nanodelivery`, status `active`, no tariff (quotes the standard city rate), no service-area limit |
| `iam.delivery_drivers` | one per `--rider-email` | active riders, name and phone from their profile |
| `iam.profiles` | the owner | what activating a store does: `seller_status = READY`, `primary_store_id` (only if empty), role `seller` (only if it was `customer`). If their onboarding was never finished it is marked completed, because `READY` requires it (a database CHECK). The dry run lists these exact changes. |

The verification tier is one named constant, `HOUSE_STORE_VERIFICATION_TIER` in
`HouseStoreProvisioner.js` (`official_brand`, the highest tier the schema allows). Change it there.

A profile can hold only one provider record. The owner's record is the agency, so the owner cannot
also be a plain rider, and an owner who is already registered as something else is reported as a blocker.

## Running it

Run it from the repository root (the product count is read from `src/data/`). Against production,
the project documents running scripts with the Railway CLI from the `keen-expression` project,
`LOUMOO` service, which supplies the production environment variables to your local copy of the script:

```bash
# 1. Dry run. Writes nothing. Prints who the email matched and every row it would create or change.
railway run node scripts/provision_nanoafrica.js \
  --owner-email YOU@example.com \
  --phone +2376XXXXXXXX \
  --rider-email rider1@example.com

# 2. Read the output: is the matched account really yours? Is the database host the one you intend?
#    The last line gives the exact confirmation to use.

# 3. Apply. Repeat the SAME command and add the two flags:
railway run node scripts/provision_nanoafrica.js \
  --owner-email YOU@example.com \
  --phone +2376XXXXXXXX \
  --rider-email rider1@example.com \
  --apply --confirm-owner-id <the id printed in step 1>
```

Options: `--owner-email` or `--owner-id` (exactly one), `--phone`, `--store-email`, `--rider-email`
(repeatable), `--city`, `--street`, `--json`, `--help`. Without a local Railway CLI, the same command
works with `node` if `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in the shell.

Guarantees, each covered by `tests/e2e/house_store_provision.test.js` (real migrations on PGlite):

- **Dry run by default.** `--apply` alone is refused; it also needs `--confirm-owner-id` equal to the
  id the lookup matched.
- **Email is matched only here**, only when it is verified, and only when exactly one live account has
  it. The runtime identity layer never matches by email. The email is always shown masked.
- **Phone is required.** If the owner profile has none and `--phone` is not given, the dry run warns
  loudly and `--apply` refuses (buyers could not call or WhatsApp the store).
- **Idempotent.** A second run changes nothing. Missing rows are created; existing rows only get blank
  fields filled and the `product_count` refreshed. Tariff, service areas, description, logo, hours,
  phone once set, a suspended status: all left as the owner or an admin set them (a suspended store is
  reported as a warning, not silently reactivated).
- **Conflicts stop the run.** A store or organization with these ids that belongs to another account, a
  slug taken by something else, a rider who is an agency: reported as BLOCKERS, nothing is written.
- **Errors abort.** There is no "continue anyway" fallback; every step is idempotent, so fix the cause and
  run the same command again.

Exit codes: `0` done, `1` refused or failed, `2` bad usage, `3` dry run found blockers.

## Checking it worked

1. Run the dry-run command again. It should say *Everything already exists. Nothing to do.*
2. `GET /api/v1/products?storeId=store_nanoafrica&limit=3` returns curated products with
   `storeName: "NanoAfrica"`; `GET /api/v1/products/<id>` has a `store` block with your phone, rating and city.
   (Catalogue responses are cached for 60 to 120 seconds.)
3. Sign in as the owner: the account is a seller, Seller Studio opens and the dispatch board is available.
   The server caches a signed-in profile for up to 5 minutes; sign out and in if the old state shows.
4. Place a test order with a second account for one curated product (pay on delivery). The owner gets an
   in-app notification and the order appears in their orders. Check in SQL:

   ```sql
   SELECT id, seller_id, buyer_id, order_number, total_amount_xaf FROM iam.orders ORDER BY created_at DESC LIMIT 3;
   SELECT id, owner_id, status, is_verified, verification_tier, product_count FROM iam.stores WHERE id = 'store_nanoafrica';
   SELECT profile_id, display_name, is_agency, organization_id, status FROM iam.delivery_drivers WHERE organization_id = 'org_nanodelivery' OR profile_id IN (SELECT owner_id FROM iam.stores WHERE id = 'store_nanoafrica');
   ```

## Adding a rider to nanoDelivery later

The rider needs a LOUMOO account with a verified email and a phone number on the profile. Run the
provisioning command again with one more `--rider-email` (existing riders are left untouched), then `--apply`
with the confirmation. That registers them as an active rider and as a member of `org_nanodelivery`, so the
agency can hand them deliveries. Tell the rider to open the delivery section of their account: the script
does not send them a notification.

## Undoing it

Only safe before the first real order: once orders and deliveries reference the owner, delete nothing.
It also deletes anything the owner has added to the store since (their own listings, announcements,
uploads), because deleting the store row cascades to them: check Seller Studio first.
Keep the dry-run output of the first run: it shows the owner's role and seller status *before* the change.
Children before parents:

```sql
BEGIN;
-- riders you registered with --rider-email (list their profile ids), and the agency provider record
DELETE FROM iam.delivery_drivers WHERE profile_id IN ('<rider id>', '<rider id>');
DELETE FROM iam.delivery_drivers WHERE is_agency AND organization_id = 'org_nanodelivery';
DELETE FROM iam.organization_members WHERE organization_id = 'org_nanodelivery';
DELETE FROM iam.organizations WHERE id = 'org_nanodelivery';
DELETE FROM iam.store_hours WHERE store_id = 'store_nanoafrica';
DELETE FROM iam.store_settings WHERE store_id = 'store_nanoafrica';
DELETE FROM iam.store_locations WHERE store_id = 'store_nanoafrica';
DELETE FROM iam.store_profiles WHERE store_id = 'store_nanoafrica';
DELETE FROM iam.store_members WHERE store_id = 'store_nanoafrica';
UPDATE iam.profiles SET primary_store_id = NULL WHERE primary_store_id = 'store_nanoafrica';
DELETE FROM iam.stores WHERE id = 'store_nanoafrica';
-- optionally put the owner's account back as the dry run printed it, e.g.:
-- UPDATE iam.profiles SET seller_status = 'NONE', primary_role = 'customer' WHERE id = '<owner id>';
COMMIT;
```

After this the store row is gone and curated products are refused at checkout again, as before.

## Honest limits

- **No payment gateway exists in this repository.** Orders are pay on delivery or pickup; nothing is
  held, paid or refunded online, and the store's settings say so (no escrow, no mobile-money methods).
- **Email depends on the mail transport configured in production** (Gmail SMTP needs `GOOGLE_APP_PASSWORD`;
  without it email is disabled and logged). The in-app notification in `iam.notifications` is the guaranteed
  channel; the email is best effort.
- **The public store page** (`GET /api/v1/stores/s/:slug`, served by `PublicProfileService`) lists a store's
  products from `iam.listings` only, so for NanoAfrica it shows no products and a listing count of 0 until that
  service asks the catalogue for the house store (`CatalogRepository.curatedStorefront()` exists for it). The
  store *directory* shows the truthful `product_count` written at provisioning; re-run the script to refresh it
  if the dataset size changes.
- **One boutique per seller.** After provisioning, the owner cannot create a second store through the app
  (`POST /stores` answers "You already have a LOUMOO boutique"); NanoAfrica is their boutique.
- **Caches.** The running server re-reads the store row within 5 seconds of a miss and 30 seconds of a hit;
  catalogue responses are cached 60 to 120 seconds; a signed-in profile for up to 5 minutes.
- **Not verified against the real Supabase project.** The tests run the real migrations and the real client on a
  local Postgres (PGlite) behind a PostgREST stand-in. The script's first run against production is the
  dry run above.
