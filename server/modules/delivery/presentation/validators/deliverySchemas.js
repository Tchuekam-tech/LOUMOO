/**
 * LOUMOO Delivery — Input Validation Schemas
 * ---------------------------------------------------------------------------
 * Zod schemas with strict key rejection, the same trust boundary the order
 * module uses: a client can never smuggle in privileged fields (buyerId,
 * sellerId, driverId on create, status on assign, ...). These check shape and
 * types only; the service owns the real rules (ranges, lengths, authorisation).
 */

const { z } = require('zod');

// Coordinates may arrive as numbers or numeric strings; the service validates
// the range and rejects NaN/Infinity.
const NumberLike = z.union([z.number(), z.string().trim().min(1).max(40)]);

const LocationSchema = z.object({ lat: NumberLike, lng: NumberLike }).strict();

const CreateDeliverySchema = z.object({
  orderId: z.string().trim().min(1, 'orderId is required').max(128),
  pickup: z.object({
    label: z.string().max(200).optional().nullable(),
    address: z.string().max(400).optional().nullable(),
    location: LocationSchema.optional().nullable()
  }).strict().optional().nullable(),
  dropoffLocation: LocationSchema.optional().nullable(),
  dropoffAddress: z.string().max(400).optional().nullable()
}).strict({ message: 'Unexpected field in delivery request.' });

const AssignDriverSchema = z.object({
  driverId: z.string().trim().min(1, 'driverId is required').max(128)
}).strict();

const CancelDeliverySchema = z.object({
  reason: z.string().max(600).optional().nullable()
}).strict();

module.exports = {
  CreateDeliverySchema,
  AssignDriverSchema,
  CancelDeliverySchema
};
