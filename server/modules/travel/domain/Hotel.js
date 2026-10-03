/**
 * LOUMOO Hotel & Room Domain Entities
 */

// Accept only a real https URL for an external virtual tour (virtualtour.nu,
// Matterport, Kuula, …). Everything else collapses to '' so the UI cleanly
// hides the CTA rather than linking somewhere broken or insecure.
function normalizeTourUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^https:\/\/[^\s]+\.[^\s]+/i.test(s) ? s : '';
}

// Canonicalize a hotel "space" (a named area with its own virtual tour):
// lobby, restaurant, spa, pool, a suite category, the rooftop, etc.
const SPACE_CATEGORIES = ['Room', 'Suite', 'Lobby', 'Restaurant', 'Bar', 'Spa', 'Pool', 'Gym', 'Event Space', 'Exterior', 'Space'];
function normalizeSpace(sp = {}) {
  const images = Array.isArray(sp.images) ? sp.images.filter(Boolean)
    : (sp.image ? [sp.image] : []);
  const amenities = Array.isArray(sp.amenities) ? sp.amenities
    : (Array.isArray(sp.features) ? sp.features : []);
  const rawCat = (sp.category || sp.type || 'Space').trim();
  const category = SPACE_CATEGORIES.find(c => c.toLowerCase() === rawCat.toLowerCase()) || rawCat || 'Space';
  return {
    id: sp.id || `sp_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    name: (sp.name || sp.title || '').trim(),
    category,
    description: (sp.description || sp.summary || '').trim(),
    image: images[0] || '',
    images,
    amenities,
    virtualTourUrl: normalizeTourUrl(sp.virtualTourUrl || sp.virtual_tour_url || sp.tourUrl || sp.tour_url || sp.url)
  };
}

class Room {
  constructor(data = {}) {
    this.id = data.id || `rm_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.hotelId = data.hotelId || data.hotel_id || '';
    this.name = (data.name || '').trim();
    this.description = data.description || '';
    this.capacity = Number(data.capacity ?? 2);
    this.price = Number(data.price ?? 0); // nightly rate
    this.currency = data.currency || 'XAF';
    this.totalInventory = Number(data.totalInventory ?? data.total_inventory ?? 5);
    this.availableInventory = Number(data.availableInventory ?? data.available_inventory ?? this.totalInventory);
    this.amenities = Array.isArray(data.amenities) ? data.amenities : [];
    this.images = Array.isArray(data.images) ? data.images : [];
    this.cancellationPolicy = data.cancellationPolicy || data.cancellation_policy || 'FREE_CANCELLATION_24H';
    // Optional external immersive tour for this specific room (virtualtour.nu,
    // Matterport, etc.). Only a real https URL is kept; anything else -> ''.
    this.virtualTourUrl = normalizeTourUrl(data.virtualTourUrl || data.virtual_tour_url || data.tourUrl || data.tour_url);
  }

  isAvailable(requestedRooms = 1) {
    return this.availableInventory >= requestedRooms;
  }

  calculateStayPrice(nights = 1, roomsCount = 1) {
    const validNights = Math.max(1, Number(nights) || 1);
    const validRooms = Math.max(1, Number(roomsCount) || 1);
    const subtotal = this.price * validNights * validRooms;
    const taxes = 0;
    const serviceFee = Math.round(subtotal * 0.02); // 2% service fee
    return {
      nightlyPrice: this.price,
      nights: validNights,
      roomsCount: validRooms,
      subtotal,
      serviceFee,
      taxes,
      totalAmount: subtotal + serviceFee + taxes,
      currency: this.currency
    };
  }

  toJSON() {
    return {
      id: this.id,
      hotelId: this.hotelId,
      name: this.name,
      description: this.description,
      capacity: this.capacity,
      price: this.price,
      nightlyPrice: this.price,
      currency: this.currency,
      availability: this.availableInventory > 0,
      totalInventory: this.totalInventory,
      availableInventory: this.availableInventory,
      amenities: this.amenities,
      images: this.images,
      virtualTourUrl: this.virtualTourUrl,
      hasVirtualTour: Boolean(this.virtualTourUrl),
      cancellationPolicy: this.cancellationPolicy
    };
  }
}

class Hotel {
  constructor(data = {}) {
    this.id = data.id || `htl_${Date.now()}`;
    this.providerId = data.providerId || data.provider_id || '';
    // The account that created/claimed this hotel (empty for unclaimed seed
    // properties). Management endpoints are scoped to the owner or an admin.
    this.ownerId = data.ownerId || data.owner_id || '';
    this.name = (data.name || '').trim();
    this.description = data.description || '';
    this.location = (data.location || '').trim();
    this.city = (data.city || '').trim();
    this.country = data.country || 'Cameroon';
    this.latitude = Number(data.latitude ?? 0);
    this.longitude = Number(data.longitude ?? 0);
    this.rating = Number(data.rating ?? 4.5);
    this.starLabel = (data.starLabel || data.star_label || '').trim();
    this.amenities = Array.isArray(data.amenities) ? data.amenities : [];
    this.images = Array.isArray(data.images) ? data.images : [];
    this.priceFrom = Number(data.priceFrom ?? data.price_from ?? 0);
    this.currency = data.currency || 'XAF';
    this.status = data.status || 'ACTIVE';
    this.contact = data.contact || {};
    this.phone = data.phone || (data.contact && data.contact.phone) || '';
    this.whatsapp = data.whatsapp || (data.contact && (data.contact.whatsapp || data.contact.phone)) || this.phone || '';
    this.rooms = Array.isArray(data.rooms)
      ? data.rooms.map(r => (r instanceof Room ? r : new Room({ ...r, hotelId: this.id })))
      : [];

    // Property-level immersive tour + named "spaces" (lobby, restaurant, spa,
    // pool, suites…), each linking to an external 360°/virtual-tour experience.
    // This is the model a hotel fills in instead of uploading photos/videos.
    this.virtualTourUrl = normalizeTourUrl(data.virtualTourUrl || data.virtual_tour_url || data.tourUrl || data.tour_url);
    this.spaces = Array.isArray(data.spaces)
      ? data.spaces.map(normalizeSpace).filter(s => s.name)
      : [];
    
    // Dynamically calculate priceFrom if rooms exist
    if (this.rooms.length > 0 && (!this.priceFrom || this.priceFrom === 0)) {
      this.priceFrom = Math.min(...this.rooms.map(r => r.price));
    }
  }

  getRoomById(roomId) {
    return this.rooms.find(r => r.id === roomId) || null;
  }

  toJSON() {
    return {
      id: this.id,
      providerId: this.providerId,
      ownerId: this.ownerId,
      name: this.name,
      description: this.description,
      location: this.location,
      city: this.city,
      country: this.country,
      latitude: this.latitude,
      longitude: this.longitude,
      rating: this.rating,
      starLabel: this.starLabel,
      amenities: this.amenities,
      images: this.images,
      priceFrom: this.priceFrom,
      currency: this.currency,
      status: this.status,
      contact: this.contact,
      phone: this.phone,
      whatsapp: this.whatsapp,
      virtualTourUrl: this.virtualTourUrl,
      hasVirtualTour: Boolean(this.virtualTourUrl),
      spaces: this.spaces,
      hasSpaces: this.spaces.length > 0,
      rooms: this.rooms.map(r => r.toJSON())
    };
  }
}

module.exports = { Hotel, Room, normalizeTourUrl, normalizeSpace, SPACE_CATEGORIES };
