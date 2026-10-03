/**
 * LOUMOO Travel Service & Multi-Modal Provider Orchestrator
 * ---------------------------------------------------------------------------
 * Central orchestration facade uniting Search, Hotels, Transport, Excursions,
 * Booking Engine, Seat Inventory, Trips, and Tickets.
 */

const { travelRepository } = require('../infrastructure/TravelRepository');
const { travelSearchEngine } = require('./TravelSearchEngine');
const { hotelAvailabilityService } = require('./HotelAvailabilityService');
const { seatInventoryService } = require('./SeatInventoryService');
const { bookingEngine } = require('./BookingEngine');
const { paymentVerificationService } = require('./PaymentVerificationService');
const travelData = require('../data/travelData');
const { NotFoundError, ValidationError, AuthenticationError, AuthorizationError, ConflictError } = require('../../../shared/errors/AppError');
const logger = require('../../../shared/logging/logger');

class TravelService {
  constructor(repo = travelRepository, bookingEngineInstance = bookingEngine, seatService = seatInventoryService) {
    this.repo = repo;
    this.searchEngine = travelSearchEngine;
    this.hotelService = hotelAvailabilityService;
    this.seatService = seatService;
    this.bookingEngine = bookingEngineInstance;
    this.data = travelData;
  }

  // 1. Normalized Multi-Modal Search (Promise + Synchronous Legacy Properties)
  search(params = {}) {
    const legacy = this._legacySearch(params);
    const asyncPromise = this.searchEngine.search(params).then(results => {
      return {
        ...results,
        ...legacy,
        data: legacy
      };
    });
    // Attach legacy properties directly to the promise so synchronous test/code callers don't break
    Object.assign(asyncPromise, legacy);
    return asyncPromise;
  }

  _legacySearch({ type = 'all', origin = '', destination = '', departureDate = '', passengers = 1, classType = 'all' }) {
    const results = {
      query: { type, origin, destination, departureDate, passengers, classType },
      buses: [],
      flights: [],
      trains: [],
      taxis: [],
      tours: []
    };

    const normOrigin = origin.trim().toLowerCase();
    const normDest = destination.trim().toLowerCase();

    // Bus Search
    if (type === 'all' || type === 'bus') {
      results.buses = this.data.busSchedules.filter(b => {
        const matchOrigin = !normOrigin || b.origin.toLowerCase().includes(normOrigin) || b.route.toLowerCase().includes(normOrigin);
        const matchDest = !normDest || b.destination.toLowerCase().includes(normDest) || b.route.toLowerCase().includes(normDest);
        const matchClass = classType === 'all' || b.busClassId === classType || b.busClass.toLowerCase().includes(classType);
        return matchOrigin && matchDest && matchClass;
      });
    }

    // Flight Search
    if (type === 'all' || type === 'flight') {
      results.flights = this.data.flights.filter(f => {
        const matchOrigin = !normOrigin || f.origin.toLowerCase().includes(normOrigin) || f.originCode.toLowerCase().includes(normOrigin);
        const matchDest = !normDest || f.destination.toLowerCase().includes(normDest) || f.destinationCode.toLowerCase().includes(normDest);
        return matchOrigin && matchDest;
      });
    }

    // Train Search
    if (type === 'all' || type === 'train') {
      results.trains = this.data.trains.filter(t => {
        const matchOrigin = !normOrigin || t.origin.toLowerCase().includes(normOrigin);
        const matchDest = !normDest || t.destination.toLowerCase().includes(normDest);
        return matchOrigin && matchDest;
      });
      if (normDest && !['yaoundé', 'yaounde', 'douala', 'ngaoundéré', 'ngaoundere'].some(c => normDest.includes(c))) {
        results.trainRouteNotice = `No train service currently operates to '${destination}'. Camrail passenger lines operate between Douala, Yaoundé, and Ngaoundéré.`;
      }
    }

    // Taxi Transfers Search
    if (type === 'all' || type === 'taxi') {
      results.taxis = this.data.taxis;
    }

    // Tourism Packages
    if (type === 'all' || type === 'tour') {
      results.tours = this.data.packages.filter(p => {
        return !normDest || p.destination.toLowerCase().includes(normDest) || p.title.toLowerCase().includes(normDest);
      });
    }

    return results;
  }

  // 2. Destinations
  async getDestinations() {
    return this.repo.getDestinations();
  }

  // 3. Hotels & Rooms
  async getHotels(filters = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
    const all = await this.repo.getHotels(filters);

    const total = all.length;
    const startIndex = (page - 1) * limit;
    const items = all.slice(startIndex, startIndex + limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  async getHotelById(hotelId) {
    const hotel = await this.repo.getHotelById(hotelId);
    if (!hotel) {
      throw new NotFoundError(`Hotel '${hotelId}' not found`);
    }
    return hotel;
  }

  async getHotelRooms(hotelId, params = {}) {
    await this.getHotelById(hotelId); // asserts existence
    return this.repo.getHotelRooms(hotelId, params);
  }

  // --- HOTEL MANAGEMENT (the "For Hotels" upload: profile + virtual tours) ---
  _validateTourUrl(url, field) {
    if (url == null || url === '') return; // optional
    const s = String(url).trim();
    if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(s)) {
      throw new ValidationError('Virtual tour link must be a valid https:// URL', [
        { field, message: 'Paste the full https:// link to the virtual tour (e.g. from virtualtour.nu or Matterport).' }
      ]);
    }
  }

  _validateSpaces(spaces) {
    if (spaces === undefined) return;
    if (!Array.isArray(spaces)) {
      throw new ValidationError('spaces must be a list', [{ field: 'spaces', message: 'Provide a list of spaces.' }]);
    }
    if (spaces.length > 40) {
      throw new ValidationError('A hotel can list at most 40 spaces', [{ field: 'spaces', message: 'Limit to 40 spaces.' }]);
    }
    spaces.forEach((sp, i) => {
      if (!sp || typeof sp !== 'object') {
        throw new ValidationError(`Space ${i + 1} is invalid`, [{ field: `spaces[${i}]`, message: 'Each space must be an object.' }]);
      }
      const name = (sp.name || sp.title || '').trim();
      if (!name) {
        throw new ValidationError(`Space ${i + 1} needs a name`, [{ field: `spaces[${i}].name`, message: 'Name the space (e.g. Deluxe Suite, Lobby, Rooftop Bar).' }]);
      }
      this._validateTourUrl(sp.virtualTourUrl || sp.virtual_tour_url || sp.tourUrl || sp.url, `spaces[${i}].virtualTourUrl`);
    });
  }

  async createHotel(data = {}, { user } = {}) {
    const name = (data.name || '').trim();
    if (!name) throw new ValidationError('Hotel name is required', [{ field: 'name', message: 'Provide the hotel name.' }]);
    const city = (data.city || '').trim();
    if (!city) throw new ValidationError('Hotel city is required', [{ field: 'city', message: 'Provide the city (e.g. Douala, Yaoundé).' }]);
    this._validateTourUrl(data.virtualTourUrl, 'virtualTourUrl');
    this._validateSpaces(data.spaces);
    const ownerId = user && user.id ? user.id : '';
    return this.repo.createHotel({ ...data, providerId: data.providerId || ownerId, ownerId });
  }

  async updateHotel(hotelId, patch = {}, { user } = {}) {
    await this.getHotelById(hotelId); // asserts existence
    if (patch.virtualTourUrl !== undefined) this._validateTourUrl(patch.virtualTourUrl, 'virtualTourUrl');
    if (patch.spaces !== undefined) this._validateSpaces(patch.spaces);
    return this.repo.updateHotel(hotelId, patch);
  }

  async setHotelSpaces(hotelId, spaces = [], { user } = {}) {
    await this.getHotelById(hotelId); // asserts existence
    this._validateSpaces(spaces);
    return this.repo.setHotelSpaces(hotelId, spaces);
  }

  async checkHotelRoomAvailability(params) {
    return this.hotelService.checkRoomAvailability(params);
  }

  // 4. Excursions
  async getExcursions(filters = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
    const all = await this.repo.getExcursions(filters);

    const total = all.length;
    const startIndex = (page - 1) * limit;
    const items = all.slice(startIndex, startIndex + limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  async getExcursionById(id) {
    const exc = await this.repo.getExcursionById(id);
    if (!exc) {
      throw new NotFoundError(`Excursion '${id}' not found`);
    }
    return exc.toJSON();
  }

  // 5. Transport Modalities
  async getTransportServices(type, filters = {}) {
    return this.repo.getTransportServices({ ...filters, type });
  }

  getBusOperators() {
    return this.data.busOperators;
  }

  getBusSchedules(query = {}) {
    let schedules = this.data.busSchedules;
    if (query.origin) {
      const o = query.origin.toLowerCase().trim();
      schedules = schedules.filter(s => (s.origin && s.origin.toLowerCase().includes(o)) || (s.route && s.route.toLowerCase().includes(o)));
    }
    if (query.destination) {
      const d = query.destination.toLowerCase().trim();
      schedules = schedules.filter(s => (s.destination && s.destination.toLowerCase().includes(d)) || (s.route && s.route.toLowerCase().includes(d)));
    }
    if (query.operatorId) {
      schedules = schedules.filter(s => s.operatorId === query.operatorId);
    }
    if (query.classId && query.classId !== 'all') {
      schedules = schedules.filter(s => s.busClassId === query.classId);
    }
    return schedules;
  }

  getBusSeats(scheduleId) {
    const service = this.repo.getTransportServiceById(scheduleId);
    const syncMap = service ? service.getSeatMap() : { scheduleId, layoutType: '2x1', totalSeats: 28, occupiedSeats: [], seatLayout: [] };
    const asyncPromise = this.seatService.getSeatMap(scheduleId);
    Object.assign(asyncPromise, syncMap);
    return asyncPromise;
  }

  // 6. Taxi / Airport Transfers
  calculateTaxiQuote({ type = 'city', origin = '', destination = '', vehicleClass = 'comfort' }) {
    const taxiOption = this.data.taxis.find(t => t.type === type) || this.data.taxis[0];
    const vClass = taxiOption.vehicleClasses.find(vc => vc.id === vehicleClass) || taxiOption.vehicleClasses[0];

    const basePrice = vClass.price || (taxiOption.basePrice * (vClass.multiplier || 1.0));
    return {
      type,
      origin: origin || 'Current Location',
      destination: destination || 'Selected Destination',
      vehicleClass: vClass.name,
      estimatedPrice: Math.round(basePrice),
      currency: 'XAF',
      etaMinutes: taxiOption.etaMinutes || 8,
      capacity: vClass.capacity,
      driverAssigned: {
        name: 'Jean-Paul M.',
        rating: 4.9,
        trips: 840,
        vehicleModel: vClass.name.includes('SUV') ? 'Toyota Prado VIP' : 'Toyota Avensis AC'
      }
    };
  }

  // 7. Packages & Visa Concierge
  getPackages() {
    return this.data.packages;
  }

  getPackageById(packageId) {
    const pkg = this.data.packages.find(p => p.id === packageId || p.slug === packageId);
    if (!pkg) {
      throw new NotFoundError(`Tourism package '${packageId}' not found`);
    }
    return pkg;
  }

  getVisaDestinations() {
    return this.data.visaDestinations;
  }

  getVisaDestinationById(visaId) {
    const visa = this.data.visaDestinations.find(v => v.id === visaId || v.country.toLowerCase().includes(visaId.toLowerCase()));
    if (!visa) {
      throw new NotFoundError(`Visa country destination '${visaId}' not found`);
    }
    return visa;
  }

  async submitVisaApplication(payload = {}, options = {}) {
    if (!payload.country || !payload.applicantName || !payload.phone) {
      throw new ValidationError('Country, applicantName and phone are required for visa concierge');
    }

    const user = options.user || payload.user;
    if (!user || !user.id || user.id === 'usr_guest') {
      throw new AuthenticationError('Authentication required to submit visa application');
    }

    const bookingResult = await this.bookingEngine.createBooking({
      type: 'visa',
      passengerName: payload.applicantName,
      phone: payload.phone,
      amount: 25000,
      itinerary: {
        country: payload.country,
        visaType: payload.visaType || 'Tourist (Type C)',
        plannedTravelDate: payload.plannedTravelDate || 'Within 60 days',
        appointmentCenter: 'TLScontact / Consular Concierge'
      }
    }, { user });

    return bookingResult.booking;
  }

  // 8. Transactional Booking Engine
  async createBooking(payload, options = {}) {
    return this.bookingEngine.createBooking(payload, options);
  }

  /**
   * Normalizes a contact string for guest-verification comparison.
   * Phone numbers are reduced to digits so '+237 671 00 11 22' matches
   * '237671001122'; emails are lowercased and trimmed.
   */
  static _normalizeContact(value) {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim().toLowerCase();
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    // Compare on the national significant number so country-code formatting
    // differences ('+237 6..' vs '6..') do not cause false rejections.
    return digits.length > 9 ? digits.slice(-9) : digits;
  }

  /**
   * A guest booking has no authenticated owner, so the caller must prove
   * possession of a contact detail recorded on the reservation — the same
   * "reference + surname/phone" factor every OTA requires. Without this,
   * knowing a booking reference alone would disclose the full passenger
   * roster and the boarding QR payload.
   */
  static _guestVerificationMatches(booking, verification = {}) {
    const candidates = [];
    for (const p of booking.passengers || []) {
      if (p.phone) candidates.push(TravelService._normalizeContact(p.phone));
      if (p.email) candidates.push(TravelService._normalizeContact(p.email));
      if (p.name) {
        const fullName = String(p.name).trim().toLowerCase();
        candidates.push(fullName);
        // The documented factor is reference + SURNAME, but only the full name
        // as recorded on the reservation was ever a candidate, so a traveller
        // sending just their surname was always rejected.
        const surname = fullName.split(/\s+/).pop();
        if (surname && surname !== fullName) candidates.push(surname);
      }
    }
    const supplied = [verification.phone, verification.email, verification.lastName, verification.name]
      .map(v => TravelService._normalizeContact(v) || String(v || '').trim().toLowerCase())
      .filter(Boolean);

    if (supplied.length === 0) return false;
    return supplied.some(s => candidates.includes(s));
  }

  async getBookingById(bookingId, userOrId = null, options = {}) {
    const b = await this.repo.getBookingById(bookingId);
    if (!b) {
      throw new NotFoundError('Booking', bookingId);
    }
    const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
    const userObj = typeof userOrId === 'object' && userOrId !== null ? userOrId : options.user;
    const isPrivileged = (userObj && ['admin', 'super_admin'].includes(userObj.primaryRole || userObj.role)) || userId === 'admin';
    const isGuestBooking = Boolean(b.userId && b.userId.startsWith('usr_guest_'));
    const isOwner = Boolean(userId && b.userId === userId);

    // Guest reservations are reachable only via the reference endpoint, and
    // only when the caller supplies a matching contact detail.
    const guestVerified = isGuestBooking
      && options.allowGuestVerification === true
      && TravelService._guestVerificationMatches(b, options.verification || {});

    if (!isPrivileged && !isOwner && !guestVerified) {
      // Anti-enumeration: never distinguish "exists but not yours" from "absent".
      throw new NotFoundError('Booking', bookingId);
    }

    const scopeUserId = (isPrivileged || guestVerified) ? null : userId;
    const trip = await this.repo.getTripById(b.id, scopeUserId);
    const ticket = await this.repo.getTicketByIdOrBooking(b.id, scopeUserId);
    return {
      ...b.toJSON(),
      trip,
      ticket,
      qrCodePayload: ticket?.qrPayload || ''
    };
  }

  async getBookingByReference(reference, userOrId = null, options = {}) {
    return this.getBookingById(reference, userOrId, {
      ...options,
      allowGuestVerification: true
    });
  }

  async cancelBooking(bookingId, userId, reason, options = {}) {
    const targetUserId = typeof userId === 'object' && userId !== null ? userId.id : userId;
    const userObj = typeof userId === 'object' && userId !== null ? userId : options.user;
    return this.bookingEngine.cancelBooking(bookingId, targetUserId, reason, { ...options, user: userObj });
  }

  /** Exposes guest-holder proof-of-possession to the presentation layer. */
  verifyGuestHolder(booking, verification = {}) {
    return TravelService._guestVerificationMatches(booking, verification);
  }

  /**
   * The only sanctioned path from PENDING_PAYMENT to PAID. Settlement is
   * attested by PaymentVerificationService against the provider; the caller
   * cannot assert it. On success the booking is promoted to CONFIRMED and its
   * ticket becomes valid for travel.
   */
  async confirmPayment(bookingId, { provider, transactionRef, expectedAmount } = {}) {
    const booking = await this.repo.getBookingById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    const attested = await paymentVerificationService.verify({
      provider,
      transactionRef,
      expectedAmount: expectedAmount ?? booking.pricing?.totalAmount,
      currency: booking.pricing?.currency || 'XAF'
    });

    return this.recordPaymentConfirmation(booking.id, {
      provider: attested.provider,
      transactionRef: attested.transactionRef,
      amount: attested.amount,
      confirmedAt: attested.confirmedAt
    });
  }

  /**
   * Applies an already-attested settlement. Internal/trusted callers only
   * (confirmPayment above, or a signed provider webhook) — never bind this
   * directly to a client-facing route.
   */
  async recordPaymentConfirmation(bookingId, confirmationDetails = {}) {
    const booking = await this.repo.getBookingById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }
    try {
      booking.recordPaymentConfirmation(confirmationDetails);
    } catch (err) {
      // Lifecycle violations (already paid, cancelled) are client conflicts,
      // not unhandled server faults leaking a stack trace as a 500.
      throw new ConflictError(err.message);
    }
    await this.repo.updatePaymentStatus(booking.id, booking.payment);
    const ticket = await this.repo.markBookingConfirmed(booking.id, booking);
    return { ...booking.toJSON(), ticket: ticket ? ticket.toJSON() : null };
  }

  async getUserBookings(userId, status = 'all') {
    const targetUserId = typeof userId === 'object' && userId !== null ? userId.id : userId;
    return this.repo.getUserBookings(targetUserId, status);
  }

  // 9. Trips (Powers My Trips)
  async getUserTrips(userId, status = 'all') {
    const targetUserId = typeof userId === 'object' && userId !== null ? userId.id : userId;
    return this.repo.getUserTrips(targetUserId, status);
  }

  async getTripById(tripId, userOrId = null, options = {}) {
    const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
    const userObj = typeof userOrId === 'object' && userOrId !== null ? userOrId : options.user;
    const isPrivileged = (userObj && ['admin', 'super_admin'].includes(userObj.primaryRole || userObj.role)) || userId === 'admin';
    const trip = await this.repo.getTripById(tripId, isPrivileged ? null : userId);
    if (!trip) {
      throw new NotFoundError('Trip', tripId);
    }
    if (userId && trip.userId !== userId && !isPrivileged) {
      throw new NotFoundError('Trip', tripId);
    }
    return trip;
  }

  // 10. Tickets & QR
  async getUserTickets(userId) {
    const targetUserId = typeof userId === 'object' && userId !== null ? userId.id : userId;
    return this.repo.getUserTickets(targetUserId);
  }

  async getTicketById(ticketId, userOrId = null, options = {}) {
    const userId = typeof userOrId === 'object' && userOrId !== null ? userOrId.id : userOrId;
    const userObj = typeof userOrId === 'object' && userOrId !== null ? userOrId : options.user;
    const isPrivileged = (userObj && ['admin', 'super_admin'].includes(userObj.primaryRole || userObj.role)) || userId === 'admin';
    const ticket = await this.repo.getTicketByIdOrBooking(ticketId, isPrivileged ? null : userId);
    if (!ticket) {
      throw new NotFoundError('Ticket', ticketId);
    }
    if (userId && !isPrivileged) {
      if (ticket.userId) {
        if (ticket.userId !== userId) {
          throw new NotFoundError('Ticket', ticketId);
        }
      } else {
        const booking = await this.repo.getBookingById(ticket.bookingId);
        if (booking && booking.userId !== userId) {
          throw new NotFoundError('Ticket', ticketId);
        }
      }
    }
    return ticket;
  }
}

const travelServiceInstance = new TravelService();

module.exports = {
  TravelService,
  travelService: travelServiceInstance
};
