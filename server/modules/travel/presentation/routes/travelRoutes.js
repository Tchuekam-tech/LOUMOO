/**
 * LOUMOO Travel Presentation Routes
 * ---------------------------------------------------------------------------
 * REST endpoints for unified multi-modal search, hotels & rooms availability,
 * excursions, flights, buses, trains, rides, transactional bookings, trips, and tickets.
 */

const express = require('express');
const { travelService } = require('../../application/TravelService');
const { requireAuth, optionalAuth } = require('../../../identity/presentation/guards/authGuard');
const { ValidationError, NotFoundError, UnauthorizedError, AuthenticationError, AuthorizationError } = require('../../../../shared/errors/AppError');
const logger = require('../../../../shared/logging/logger');

const router = express.Router();

// ============================================================================
// 1. SEARCH
// ============================================================================

// GET /api/travel/search (and /api/v1/travel/search)
router.get('/search', async (req, res, next) => {
  try {
    const {
      type = 'all',
      origin = '',
      destination = '',
      date = '',
      departureDate = '',
      returnDate = '',
      passengers = 1,
      rooms = 1,
      guests = 1,
      page = 1,
      limit = 20,
      minPrice,
      maxPrice,
      rating,
      sort,
      classType
    } = req.query;

    // If client requested legacy shape specifically
    const isLegacy = req.query.legacy === 'true' || (!req.query.type && !req.query.origin && !req.query.destination && Object.keys(req.query).length === 0);
    
    if (isLegacy) {
      const legacyData = travelService._legacySearch({
        type: type || 'all',
        origin,
        destination,
        departureDate: departureDate || date,
        passengers: Number(passengers) || 1,
        classType: classType || 'all'
      });
      return res.json({
        success: true,
        data: legacyData
      });
    }

    const results = await travelService.search({
      type,
      origin,
      destination,
      date: date || departureDate,
      returnDate,
      passengers: Number(passengers || guests) || 1,
      rooms: Number(rooms) || 1,
      guests: Number(guests || passengers) || 1,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      rating: rating ? Number(rating) : undefined,
      sort
    });

    const legacyData = travelService._legacySearch({
      type,
      origin,
      destination,
      departureDate: departureDate || date,
      passengers: Number(passengers || guests) || 1,
      classType: classType || 'all'
    });

    res.json({
      success: true,
      items: results.items,
      pagination: results.pagination,
      data: {
        ...results,
        buses: legacyData.buses,
        flights: legacyData.flights,
        trains: legacyData.trains,
        taxis: legacyData.taxis,
        tours: legacyData.tours,
        trainRouteNotice: legacyData.trainRouteNotice || null
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/destinations
router.get('/destinations', async (req, res, next) => {
  try {
    const destinations = await travelService.getDestinations();
    res.json({
      success: true,
      count: destinations.length,
      items: destinations,
      data: destinations
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 2. HOTELS
// ============================================================================

// GET /api/travel/hotels - List hotels with filters & pagination
router.get('/hotels', async (req, res, next) => {
  try {
    const { city, rating, maxPrice, page = 1, limit = 20 } = req.query;
    const result = await travelService.getHotels({
      city,
      rating,
      maxPrice,
      page: Number(page) || 1,
      limit: Number(limit) || 20
    });
    res.json({
      success: true,
      items: result.items,
      pagination: result.pagination,
      data: result.items
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/hotels/:id - Get hotel details
router.get('/hotels/:id', async (req, res, next) => {
  try {
    const hotel = await travelService.getHotelById(req.params.id);
    res.json({
      success: true,
      data: hotel
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/hotels/:id/rooms - Get rooms with stay pricing calculation
router.get('/hotels/:id/rooms', async (req, res, next) => {
  try {
    const { checkIn, checkOut, guests } = req.query;
    const rooms = await travelService.getHotelRooms(req.params.id, { checkIn, checkOut, guests });
    res.json({
      success: true,
      count: rooms.length,
      items: rooms,
      data: rooms
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// 2b. HOTEL MANAGEMENT — the "For Hotels" upload (profile + virtual tours)
// ----------------------------------------------------------------------------

// Only the hotel's owner or an admin may manage it. Unclaimed seed properties
// (no ownerId) are claimable in this demo build so a manager can showcase live.
function assertCanManageHotel(hotel, principal) {
  const role = principal && (principal.primaryRole || principal.role);
  const isAdmin = ['admin', 'super_admin'].includes(role);
  if (isAdmin) return;
  const ownerId = hotel && (hotel.ownerId || '');
  if (ownerId && principal && ownerId === principal.id) return;
  if (!ownerId) return; // unclaimed — claimable in the demo
  throw new AuthorizationError('You do not manage this hotel.');
}

// POST /api/v1/travel/hotels — create/claim a hotel profile
router.post('/hotels', requireAuth, async (req, res, next) => {
  try {
    const hotel = await travelService.createHotel(req.body || {}, { user: req.principal });
    res.status(201).json({
      success: true,
      message: 'Hotel profile created. Add your virtual-tour spaces to bring it to life.',
      data: hotel
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/travel/hotels/:id — update profile (name, description, amenities, tour…)
router.put('/hotels/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await travelService.getHotelById(req.params.id);
    assertCanManageHotel(existing, req.principal);
    const hotel = await travelService.updateHotel(req.params.id, req.body || {}, { user: req.principal });
    res.json({ success: true, message: 'Hotel profile updated.', data: hotel });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/travel/hotels/:id/spaces — set the virtual-tour spaces
router.put('/hotels/:id/spaces', requireAuth, async (req, res, next) => {
  try {
    const existing = await travelService.getHotelById(req.params.id);
    assertCanManageHotel(existing, req.principal);
    const body = req.body || {};
    const spaces = Array.isArray(body) ? body : (body.spaces || []);
    const hotel = await travelService.setHotelSpaces(req.params.id, spaces, { user: req.principal });
    res.json({
      success: true,
      message: `Saved ${hotel.spaces.length} virtual-tour space${hotel.spaces.length === 1 ? '' : 's'}.`,
      data: hotel
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 3. EXCURSIONS
// ============================================================================

// GET /api/travel/excursions - List excursions
router.get('/excursions', async (req, res, next) => {
  try {
    const { destination, maxPrice, page = 1, limit = 20 } = req.query;
    const result = await travelService.getExcursions({
      destination,
      maxPrice,
      page: Number(page) || 1,
      limit: Number(limit) || 20
    });
    res.json({
      success: true,
      items: result.items,
      pagination: result.pagination,
      data: result.items
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/excursions/:id - Get excursion detail
router.get('/excursions/:id', async (req, res, next) => {
  try {
    const excursion = await travelService.getExcursionById(req.params.id);
    res.json({
      success: true,
      data: excursion
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 4. TRANSPORT (FLIGHTS, BUSES, TRAINS, RIDES)
// ============================================================================

// GET /api/travel/flights
router.get('/flights', async (req, res, next) => {
  try {
    const flights = await travelService.getTransportServices('flight', req.query);
    res.json({
      success: true,
      count: flights.length,
      items: flights,
      data: flights
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/buses
router.get('/buses', async (req, res, next) => {
  try {
    const buses = await travelService.getTransportServices('bus', req.query);
    res.json({
      success: true,
      count: buses.length,
      items: buses,
      data: buses
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/trains
router.get('/trains', async (req, res, next) => {
  try {
    const trains = await travelService.getTransportServices('train', req.query);
    res.json({
      success: true,
      count: trains.length,
      items: trains,
      data: trains
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/rides
router.get('/rides', async (req, res, next) => {
  try {
    const quote = travelService.calculateTaxiQuote(req.query);
    res.json({
      success: true,
      data: quote
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 5. BOOKINGS (AUTHENTICATED & OWNER BOUND)
// ============================================================================

// POST /api/travel/bookings - Transactional booking creation (Registered or Guest Checkout)
router.post('/bookings', optionalAuth, async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    const user = req.principal;

    const result = await travelService.createBooking(req.body, {
      idempotencyKey,
      user
    });

    res.status(201).json({
      success: true,
      message: 'Reservation held. Payment is required to confirm the booking and issue your ticket.',
      data: result.booking,
      booking: result.booking,
      trip: result.trip,
      ticket: result.ticket,           // null until payment is attested
      paymentRequired: true,
      amountDue: result.booking?.pricing?.totalAmount ?? null,
      currency: result.booking?.pricing?.currency || 'XAF'
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/travel/bookings/:id/pay - Record a payment confirmation.
//
// SECURITY: this endpoint transitions money-bearing state, so it never accepts
// the caller's word that a payment happened. The settlement itself must be
// attested by PaymentVerificationService against a real gateway; the client may
// only supply the provider reference to be verified.
router.post('/bookings/:id/pay', optionalAuth, async (req, res, next) => {
  try {
    const { paymentMethod = 'momo', provider = 'mtn_momo', transactionRef } = req.body || {};
    const userId = req.principal?.id;

    const booking = await travelService.repo.getBookingById(req.params.id);
    if (!booking) {
      throw new NotFoundError('Booking', req.params.id);
    }

    const isGuest = Boolean(booking.userId && booking.userId.startsWith('usr_guest_'));
    const isOwner = Boolean(userId && booking.userId === userId);
    const isPrivileged = Boolean(req.principal && ['admin', 'super_admin'].includes(req.principal.primaryRole || req.principal.role));

    // A guest holder proves possession of the reservation with a contact detail
    // recorded on it — never merely by knowing the booking id.
    const guestVerified = isGuest && travelService.verifyGuestHolder(booking, {
      phone: req.get('x-guest-contact') || req.body?.phoneNumber || req.body?.phone,
      email: req.body?.email,
      lastName: req.body?.lastName
    });

    if (!isPrivileged && !isOwner && !guestVerified) {
      // Anti-enumeration: identical response whether or not the booking exists.
      throw new NotFoundError('Booking', req.params.id);
    }

    const confirmed = await travelService.confirmPayment(booking.id, {
      provider: provider || paymentMethod,
      transactionRef,
      expectedAmount: booking.pricing?.totalAmount || booking.amount
    });

    res.json({
      success: true,
      message: 'Payment verified with the provider. Booking is fully confirmed.',
      data: confirmed,
      booking: confirmed
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bookings - List caller's bookings
router.get('/bookings', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const status = req.query.status || 'all';
    const bookings = await travelService.getUserBookings(userId, status);
    res.json({
      success: true,
      count: bookings.length,
      data: bookings,
      items: bookings
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bookings/my-trips (legacy path - caller's bookings)
router.get('/bookings/my-trips', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const status = req.query.status || 'all';
    const trips = await travelService.getUserBookings(userId, status);
    res.json({
      success: true,
      count: trips.length,
      data: trips,
      items: trips
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bookings/reference/:ref - Check booking by reference (OTA standard)
//
// Guests authenticate with reference + a contact detail from the reservation.
// The contact travels in the `x-guest-contact` header rather than the query
// string so it never lands in access logs, proxy caches or browser history.
router.get('/bookings/reference/:ref', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.principal?.id;
    const booking = await travelService.getBookingByReference(req.params.ref, userId, {
      user: req.principal,
      verification: {
        phone: req.get('x-guest-contact'),
        email: req.get('x-guest-email'),
        lastName: req.get('x-guest-surname')
      }
    });
    res.json({
      success: true,
      data: booking
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bookings/:id - Caller must own the booking (authenticated)
router.get('/bookings/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const booking = await travelService.getBookingById(req.params.id, userId, { user: req.principal });
    res.json({
      success: true,
      data: booking
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/travel/bookings/:id/cancel - Cancel booking
router.post('/bookings/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const reason = req.body.reason || 'Customer request';
    const cancelled = await travelService.cancelBooking(req.params.id, userId, reason, { user: req.principal });
    res.json({
      success: true,
      message: 'Booking successfully cancelled.',
      data: cancelled
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 6. TRIPS (POWERS "MY TRIPS" FRONTEND - AUTHENTICATED)
// ============================================================================

// GET /api/travel/trips - List authenticated caller's trips
router.get('/trips', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const status = req.query.status || 'all';
    const trips = await travelService.getUserTrips(userId, status);
    res.json({
      success: true,
      count: trips.length,
      items: trips,
      data: trips
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/trips/:id - Caller must own the trip
router.get('/trips/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const trip = await travelService.getTripById(req.params.id, userId, { user: req.principal });
    res.json({
      success: true,
      data: trip
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 7. TICKETS & QR (AUTHENTICATED & OWNER BOUND)
// ============================================================================

// GET /api/travel/tickets - List authenticated caller's tickets
router.get('/tickets', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const tickets = await travelService.getUserTickets(userId);
    res.json({
      success: true,
      count: tickets.length,
      items: tickets,
      data: tickets
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/tickets/:id - Caller must own the ticket
router.get('/tickets/:id', requireAuth, async (req, res, next) => {
  try {
    const userId = req.principal.id;
    const ticket = await travelService.getTicketById(req.params.id, userId, { user: req.principal });
    res.json({
      success: true,
      data: ticket
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 8. BACKWARD COMPATIBILITY LEGACY ENDPOINTS
// ============================================================================

// GET /api/travel/bus/operators
router.get('/bus/operators', async (req, res, next) => {
  try {
    const operators = await travelService.getBusOperators();
    res.json({
      success: true,
      count: operators.length,
      data: operators
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bus/schedules
router.get('/bus/schedules', async (req, res, next) => {
  try {
    const schedules = await travelService.getBusSchedules(req.query);
    res.json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/bus/seats/:scheduleId
router.get('/bus/seats/:scheduleId', async (req, res, next) => {
  try {
    const seatsData = await travelService.getBusSeats(req.params.scheduleId);
    res.json({
      success: true,
      data: seatsData
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/train/schedules
router.get('/train/schedules', async (req, res, next) => {
  try {
    const trains = await travelService.getTransportServices('train', req.query);
    res.json({
      success: true,
      count: trains.length,
      data: trains
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/taxi/quote
router.get('/taxi/quote', (req, res, next) => {
  try {
    const quote = travelService.calculateTaxiQuote(req.query);
    res.json({
      success: true,
      data: quote
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/packages
router.get('/packages', (req, res, next) => {
  try {
    const packages = travelService.getPackages();
    res.json({
      success: true,
      count: packages.length,
      data: packages
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/packages/:id
router.get('/packages/:id', (req, res, next) => {
  try {
    const pkg = travelService.getPackageById(req.params.id);
    res.json({
      success: true,
      data: pkg
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/travel/visa/destinations
router.get('/visa/destinations', (req, res, next) => {
  try {
    const destinations = travelService.getVisaDestinations();
    res.json({
      success: true,
      count: destinations.length,
      data: destinations
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/travel/visa/applications (AUTHENTICATED)
router.post('/visa/applications', requireAuth, async (req, res, next) => {
  try {
    const application = await travelService.submitVisaApplication(req.body, { user: req.principal });
    res.status(201).json({
      success: true,
      message: 'Visa assistance request submitted successfully. A LOUMOO consular specialist has been assigned.',
      data: application
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
