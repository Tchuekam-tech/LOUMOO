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

// GET /drivers?deliveryId=…  Unlike bodies, a query string is NOT strict: clients
// and proxies add harmless keys (cache busters), so unknown ones are dropped. The
// one key we read must be a single, non-empty string (a repeated `deliveryId`
// arrives as an array and is refused).
const ListDriversQuerySchema = z.object({
  deliveryId: z.string().trim().min(1, 'deliveryId must not be empty').max(128).optional(),
  // Admin roster filter (v1.2); the service refuses it for anyone but an admin.
  status: z.enum(['all', 'active', 'suspended']).optional()
});

// GET /dispatch?view=&limit=  Not strict, for the same reason as above.
const DispatchBoardQuerySchema = z.object({
  view: z.enum(['active', 'completed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const CancelDeliverySchema = z.object({
  reason: z.string().max(600).optional().nullable()
}).strict();

const RiderStatusSchema = z.object({
  status: z.string().trim().min(1, 'status is required').max(32),
  note: z.string().max(600).optional().nullable()
}).strict();

const LocationPingSchema = z.object({
  lat: NumberLike,
  lng: NumberLike,
  speedKmh: NumberLike.optional().nullable(),
  heading: NumberLike.optional().nullable(),
  accuracyM: NumberLike.optional().nullable()
}).strict();

const CompleteDeliverySchema = z.object({
  // Accept a number too: a client that sends 0042 as 42 gets a clear
  // "4 digits" error from the service rather than a type error.
  code: z.union([z.string().max(16), z.number()])
}).strict();

const RegisterDriverSchema = z.object({
  name: z.string().max(200),
  phone: z.string().max(64),
  status: z.enum(['active', 'suspended']).optional()
}).strict();

const ResolveDeliverySchema = z.object({
  action: z.enum(['unlock', 'fail']),
  note: z.string().max(600).optional().nullable()
}).strict();

module.exports = {
  CreateDeliverySchema,
  AssignDriverSchema,
  ListDriversQuerySchema,
  DispatchBoardQuerySchema,
  CancelDeliverySchema,
  RiderStatusSchema,
  LocationPingSchema,
  CompleteDeliverySchema,
  RegisterDriverSchema,
  ResolveDeliverySchema
};
