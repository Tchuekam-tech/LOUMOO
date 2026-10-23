/**
 * LOUMOO — Listing Inventory
 * ---------------------------------------------------------------------------
 * Stock is state other systems transact against, so it lives in
 * `iam.listing_inventory` (listing level) and `iam.listing_variants.stock_quantity`
 * (per combination), never in a JSON blob.
 *
 * `adjustStock` is the seller-facing write and goes straight to the repository.
 * Holding stock for an order is NOT done here — see the note at the foot of
 * the class.
 */

const ListingRepository = require('../infrastructure/ListingRepository');
const ListingInventory = require('../domain/ListingInventory');
const CacheService = require('../../../infrastructure/cache/CacheService');
const { ValidationError, NotFoundError } = require('../../../shared/errors/AppError');

class ListingInventoryUseCase {
  /**
   * Sets the on-hand quantity, either for the listing or for one variant.
   *
   * @param {object} ctx
   * @param {object} ctx.listingRow          Loaded by the ownership guard.
   * @param {number} ctx.onHand
   * @param {string} [ctx.variantId]         Adjust one combination instead.
   * @param {number} [ctx.lowStockThreshold]
   * @param {boolean} [ctx.allowBackorder]
   * @param {boolean} [ctx.trackInventory]
   */
  static async adjustStock({
    listingRow,
    onHand,
    variantId = null,
    lowStockThreshold,
    allowBackorder,
    trackInventory
  }) {
    const qty = Number(onHand);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new ValidationError('On-hand stock must be a non-negative number.', {
        fields: [{ field: 'onHand', message: 'Use zero or more.' }]
      });
    }

    if (variantId) {
      const updated = await ListingRepository.updateVariant(listingRow.id, variantId, {
        stockQuantity: qty
      });
      if (!updated) throw new NotFoundError('ListingVariant', variantId);
      await CacheService.delete(`listing:${listingRow.id}`, 'catalog').catch(() => null);
      return {
        variantId: updated.id,
        title: updated.title,
        options: updated.options_summary || {},
        stockQuantity: updated.stock_quantity
      };
    }

    const existing = await ListingRepository.getInventory(listingRow.id);

    const row = await ListingRepository.upsertInventory(listingRow.id, {
      onHand: qty,
      lowStockThreshold: lowStockThreshold ?? (existing ? existing.low_stock_threshold : 3),
      allowBackorder: allowBackorder ?? (existing ? existing.allow_backorder : false),
      trackInventory: trackInventory ?? (existing ? existing.track_inventory : true)
    });

    await CacheService.delete(`listing:${listingRow.id}`, 'catalog').catch(() => null);
    await CacheService.delPattern(`listings:store:${listingRow.store_id}:*`, 'catalog').catch(() => null);

    return new ListingInventory(row).toJSON();
  }

  /** Reads the listing-level stock record, or null when nothing is tracked. */
  static async get(listingId) {
    const row = await ListingRepository.getInventory(listingId);
    return row ? new ListingInventory(row).toJSON() : null;
  }

  /**
   * Stock is held by the order path, not from here.
   *
   * There used to be a `reserveStock` on this class. Nothing ever called it,
   * and it could not have been used safely if anything had: it read the row,
   * computed the new figure in JavaScript and wrote it back, so two orders
   * racing for the last unit would both read the same `reserved` and the
   * second write would overwrite the first.
   *
   * `OrderRepository.reserveInventory` / `releaseInventory` /
   * `consumeInventory` do this as a compare-and-swap on the row, and they are
   * wired into order creation, cancellation and delivery. Reach for those.
   */
}

module.exports = ListingInventoryUseCase;
