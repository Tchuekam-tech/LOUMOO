/**
 * LOUMOO TRAVEL & MOBILITY DATASET (CAMEROON & CEMAC)
 * Official bus operators, flight routes, Camrail passenger lines, airport taxis,
 * curated tourism excursions, and consular visa requirements.
 */

const travelData = {
  // 1. Official Intercity Bus Operators
  busOperators: [
    {
      id: 'op-general-express',
      name: 'General Express Voyages',
      shortName: 'General Express',
      slug: 'general-express-voyages',
      verified: true,
      rating: 4.7,
      reviewsCount: 1420,
      headquarters: 'Douala, Cameroon',
      phone: '+237 677 00 11 22',
      whatsapp: '+237 677 00 11 22',
      terminals: {
        Douala: 'Terminal Bépanda & Mvan Express',
        Yaoundé: 'Terminal Mvan Central',
        Bafoussam: 'Gare Routière Centrale'
      },
      fleet: ['Marcopolo Paradiso 1200 G7', 'Mercedes-Benz Travego VIP'],
      classes: ['VIP Prestige', 'Executive Classic'],
      amenities: ['Wi-Fi 6', 'Air Conditioned', 'USB Ports', 'Reclining Seats', 'Restroom Onboard', 'Snack Service']
    },
    {
      id: 'op-touristique',
      name: 'Touristique Express VIP',
      shortName: 'Touristique Express',
      slug: 'touristique-express-vip',
      verified: true,
      rating: 4.8,
      reviewsCount: 980,
      headquarters: 'Yaoundé, Cameroon',
      phone: '+237 699 33 44 55',
      whatsapp: '+237 699 33 44 55',
      terminals: {
        Douala: 'Gare VIP Bessengue',
        Yaoundé: 'Terminal Tongolo VIP',
        Ngaoundéré: 'Gare Routière Grand Nord',
        Garoua: 'Agence Centrale Plateau',
        Maroua: 'Agence Centrale Djarengol'
      },
      fleet: ['Irizar i6S VIP Sleeper', 'Scania Touring HD'],
      classes: ['Prestige Sleeper', 'VIP Business'],
      amenities: ['Wi-Fi 6', 'Full Recline Sleeper', 'Individual Screens', 'AC', 'Hot Drinks', 'Restroom']
    },
    {
      id: 'op-finexs',
      name: 'Finexs Voyages',
      shortName: 'Finexs',
      slug: 'finexs-voyages',
      verified: true,
      rating: 4.9,
      reviewsCount: 2150,
      headquarters: 'Douala (Akwa), Cameroon',
      phone: '+237 690 12 34 56',
      whatsapp: '+237 690 12 34 56',
      terminals: {
        Douala: 'Terminal Akwa Boulevard de la Liberté',
        Yaoundé: 'Terminal Tongolo / Bastos Express'
      },
      fleet: ['Volvo 9700 Luxury Coach', 'Mercedes-Benz VIP Club'],
      classes: ['VIP Prestige', 'First Class'],
      amenities: ['High-speed Wi-Fi', 'Luxury Leather Seats', 'AC', 'USB-C Fast Charging', 'Onboard Refreshments']
    },
    {
      id: 'op-buca',
      name: 'Buca Voyages',
      shortName: 'Buca',
      slug: 'buca-voyages',
      verified: true,
      rating: 4.6,
      reviewsCount: 1670,
      headquarters: 'Yaoundé, Cameroon',
      phone: '+237 675 88 99 00',
      whatsapp: '+237 675 88 99 00',
      terminals: {
        Douala: 'Terminal Mboppi & Bépanda',
        Yaoundé: 'Terminal Mvan Buca',
        Kribi: 'Agence Océan Kribi'
      },
      fleet: ['Marcopolo Viaggio 1050', 'Yutong High-Deck Executive'],
      classes: ['Executive', 'Classic Standard'],
      amenities: ['AC', 'USB Charging', 'Reclining Seats', 'Luggage Tracker']
    }
  ],

  // 2. Bus Schedules & Inventory
  busSchedules: [
    {
      id: 'bus-sch-1',
      operatorId: 'op-general-express',
      operatorName: 'General Express Voyages',
      operatorVerified: true,
      route: 'Douala (Bépanda) → Yaoundé (Mvan)',
      origin: 'Douala',
      destination: 'Yaoundé',
      departureTime: '06:00',
      arrivalTime: '09:45',
      duration: '3h 45m',
      busClass: 'VIP Prestige',
      busClassId: 'vip',
      price: 6000,
      currency: 'XAF',
      totalSeats: 28,
      availableSeats: 8,
      occupiedSeats: ['1A', '1B', '2A', '2B', '3A', '5A', '6B', '7A', '7B'],
      layoutType: '2x1',
      amenities: ['Wi-Fi 6', 'AC', 'USB Ports', 'Reclining Seats', 'Restroom']
    },
    {
      id: 'bus-sch-2',
      operatorId: 'op-finexs',
      operatorName: 'Finexs Voyages',
      operatorVerified: true,
      route: 'Douala (Akwa) → Yaoundé (Tongolo)',
      origin: 'Douala',
      destination: 'Yaoundé',
      departureTime: '07:30',
      arrivalTime: '11:15',
      duration: '3h 45m',
      busClass: 'VIP Prestige',
      busClassId: 'vip',
      price: 7500,
      currency: 'XAF',
      totalSeats: 28,
      availableSeats: 12,
      occupiedSeats: ['1A', '2C', '3A', '4A', '5C'],
      layoutType: '2x1',
      amenities: ['High-speed Wi-Fi', 'Luxury Leather', 'AC', 'USB-C', 'Snacks']
    },
    {
      id: 'bus-sch-3',
      operatorId: 'op-touristique',
      operatorName: 'Touristique Express VIP',
      operatorVerified: true,
      route: 'Douala → Ngaoundéré',
      origin: 'Douala',
      destination: 'Ngaoundéré',
      departureTime: '12:00',
      arrivalTime: '06:00',
      nextDayArrival: true,
      duration: '18h 00m',
      busClass: 'Prestige Sleeper',
      busClassId: 'sleeper',
      price: 18000,
      currency: 'XAF',
      totalSeats: 24,
      availableSeats: 6,
      occupiedSeats: ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '5B', '6A'],
      layoutType: '2x1',
      amenities: ['Full Sleeper', 'Hot Meals', 'AC', 'Individual Screens', 'Restroom']
    },
    {
      id: 'bus-sch-4',
      operatorId: 'op-buca',
      operatorName: 'Buca Voyages',
      operatorVerified: true,
      route: 'Douala (Mboppi) → Kribi (Centre)',
      origin: 'Douala',
      destination: 'Kribi',
      departureTime: '08:00',
      arrivalTime: '10:30',
      duration: '2h 30m',
      busClass: 'Executive',
      busClassId: 'exec',
      price: 4500,
      currency: 'XAF',
      totalSeats: 50,
      availableSeats: 22,
      occupiedSeats: ['1A', '1B', '1C', '2A', '2B'],
      layoutType: '2x2',
      amenities: ['AC', 'Reclining Seats', 'USB Charging']
    },
    {
      id: 'bus-sch-5',
      operatorId: 'op-general-express',
      operatorName: 'General Express Voyages',
      operatorVerified: true,
      route: 'Yaoundé (Mvan) → Bafoussam (Centre)',
      origin: 'Yaoundé',
      destination: 'Bafoussam',
      departureTime: '09:00',
      arrivalTime: '13:00',
      duration: '4h 00m',
      busClass: 'VIP Prestige',
      busClassId: 'vip',
      price: 5500,
      currency: 'XAF',
      totalSeats: 28,
      availableSeats: 14,
      occupiedSeats: ['1A', '2B', '3A'],
      layoutType: '2x1',
      amenities: ['Wi-Fi', 'AC', 'USB Charging', 'Reclining Seats']
    }
  ],

  // 3. Flight Schedules
  flights: [
    {
      id: 'fl-1',
      airline: 'Air France',
      flightNumber: 'AF949',
      aircraft: 'Boeing 777-300ER',
      route: 'DLA (Douala) → CDG (Paris)',
      origin: 'Douala',
      originCode: 'DLA',
      originTerminal: 'Terminal 1',
      destination: 'Paris',
      destinationCode: 'CDG',
      destinationTerminal: 'Terminal 2E',
      departureTime: '23:45',
      arrivalTime: '06:50',
      nextDayArrival: true,
      duration: '6h 05m',
      stops: 'Direct Non-Stop',
      stopsCount: 0,
      cabinClass: 'Economy',
      price: 485000,
      currency: 'XAF',
      baggage: '2x 23 kg checked bags included',
      refundable: 'Flexible rebooking available',
      mealIncluded: true
    },
    {
      id: 'fl-2',
      airline: 'Brussels Airlines',
      flightNumber: 'SN371',
      aircraft: 'Airbus A330-300',
      route: 'DLA (Douala) → BRU (Brussels)',
      origin: 'Douala',
      originCode: 'DLA',
      originTerminal: 'Terminal 1',
      destination: 'Brussels',
      destinationCode: 'BRU',
      destinationTerminal: 'Terminal B',
      departureTime: '22:15',
      arrivalTime: '06:10',
      nextDayArrival: true,
      duration: '6h 55m',
      stops: 'Direct Non-Stop',
      stopsCount: 0,
      cabinClass: 'Economy',
      price: 440000,
      currency: 'XAF',
      baggage: '2x 23 kg checked bags',
      refundable: 'Standard fare rules',
      mealIncluded: true
    },
    {
      id: 'fl-3',
      airline: 'Camair-Co',
      flightNumber: 'QC204',
      aircraft: 'Bombardier Dash 8 Q400',
      route: 'DLA (Douala) → NSI (Yaoundé)',
      origin: 'Douala',
      originCode: 'DLA',
      originTerminal: 'Terminal National',
      destination: 'Yaoundé',
      destinationCode: 'NSI',
      destinationTerminal: 'Terminal Nsimalen',
      departureTime: '08:30',
      arrivalTime: '09:15',
      duration: '45m',
      stops: 'Direct Non-Stop',
      stopsCount: 0,
      cabinClass: 'Economy Standard',
      price: 48500,
      currency: 'XAF',
      baggage: '1x 23 kg checked + 8 kg cabin',
      refundable: 'Standard domestic',
      mealIncluded: false
    },
    {
      id: 'fl-4',
      airline: 'Ethiopian Airlines',
      flightNumber: 'ET912',
      aircraft: 'Boeing 787-9 Dreamliner',
      route: 'DLA (Douala) → NBO (Nairobi)',
      origin: 'Douala',
      originCode: 'DLA',
      originTerminal: 'Terminal 1',
      destination: 'Nairobi',
      destinationCode: 'NBO',
      destinationTerminal: 'Terminal 1A',
      departureTime: '13:20',
      arrivalTime: '20:45',
      duration: '5h 25m',
      stops: '1 Stop via ADD',
      stopsCount: 1,
      cabinClass: 'Economy',
      price: 365000,
      currency: 'XAF',
      baggage: '2x 23 kg checked',
      refundable: 'Standard international',
      mealIncluded: true
    }
  ],

  // 4. Camrail Passenger Train Schedules
  trains: [
    {
      id: 'train-1',
      operator: 'Camrail InterCity Express',
      trainNumber: 'IC 182',
      route: 'Douala (Gare Bessengue) → Yaoundé (Gare Voyageurs)',
      origin: 'Douala',
      destination: 'Yaoundé',
      departureTime: '06:00',
      arrivalTime: '09:40',
      duration: '3h 40m',
      trainClass: '1st Class VIP',
      trainClassId: 'vip',
      price: 9000,
      currency: 'XAF',
      amenities: ['Air Conditioned', 'Complimentary Breakfast', 'Power Plugs', 'Quiet Coach'],
      availableSeats: 18
    },
    {
      id: 'train-2',
      operator: 'Camrail InterCity Express',
      trainNumber: 'IC 184',
      route: 'Douala (Gare Bessengue) → Yaoundé (Gare Voyageurs)',
      origin: 'Douala',
      destination: 'Yaoundé',
      departureTime: '14:30',
      arrivalTime: '18:10',
      duration: '3h 40m',
      trainClass: '2nd Class Standard',
      trainClassId: 'standard',
      price: 5000,
      currency: 'XAF',
      amenities: ['Comfortable Seating', 'Luggage Compartment', 'Bar Car Access'],
      availableSeats: 45
    },
    {
      id: 'train-3',
      operator: 'Camrail Transcam Overnight',
      trainNumber: 'TR 192',
      route: 'Yaoundé (Gare Voyageurs) → Ngaoundéré (Gare)',
      origin: 'Yaoundé',
      destination: 'Ngaoundéré',
      departureTime: '19:15',
      arrivalTime: '08:45',
      nextDayArrival: true,
      duration: '13h 30m',
      trainClass: 'Couchette Sleeper (2-Berth)',
      trainClassId: 'sleeper',
      price: 24000,
      currency: 'XAF',
      amenities: ['Private Couchette', 'Bedding & Linen', 'Dinner Service', 'Security Guard'],
      availableSeats: 8
    }
  ],

  // 5. Taxi & Private Transfers
  taxis: [
    {
      id: 'taxi-city',
      type: 'city',
      name: 'On-Demand City Ride',
      description: 'Immediate ride in Douala or Yaoundé with verified driver',
      basePrice: 2500,
      perKm: 300,
      etaMinutes: 6,
      currency: 'XAF',
      vehicleClasses: [
        { id: 'standard', name: 'Standard City Cab', capacity: '3 Passengers', icon: '🚗', multiplier: 1.0 },
        { id: 'comfort', name: 'Comfort Sedan (AC)', capacity: '4 Passengers', icon: '🚙', multiplier: 1.4 },
        { id: 'vip', name: 'VIP SUV 4x4', capacity: '4 Passengers · Luxury', icon: '🚘', multiplier: 2.2 }
      ]
    },
    {
      id: 'taxi-airport-dla',
      type: 'airport',
      name: 'Douala Airport (DLA) Transfer',
      description: 'Fixed-price private airport transfer with flight tracking',
      basePrice: 12000,
      currency: 'XAF',
      etaMinutes: 15,
      vehicleClasses: [
        { id: 'comfort', name: 'Comfort Sedan (AC)', capacity: '3 Bags · 3 Pax', icon: '🚙', price: 12000 },
        { id: 'vip', name: 'VIP Executive SUV', capacity: '5 Bags · 4 Pax', icon: '🚘', price: 20000 },
        { id: 'van', name: 'Executive Van 8-Pax', capacity: '8 Bags · 8 Pax', icon: '🚐', price: 30000 }
      ]
    },
    {
      id: 'taxi-airport-nsi',
      type: 'airport',
      name: 'Yaoundé Nsimalen (NSI) Transfer',
      description: 'Fixed-price airport shuttle between Yaoundé city and NSI',
      basePrice: 15000,
      currency: 'XAF',
      etaMinutes: 20,
      vehicleClasses: [
        { id: 'comfort', name: 'Comfort Sedan (AC)', capacity: '3 Bags · 3 Pax', icon: '🚙', price: 15000 },
        { id: 'vip', name: 'VIP Executive SUV', capacity: '5 Bags · 4 Pax', icon: '🚘', price: 25000 }
      ]
    },
    {
      id: 'taxi-intercity-kribi',
      type: 'intercity',
      name: 'Douala ⇄ Kribi Private Beach Transfer',
      description: 'Door-to-door private chauffeur to Kribi beachfront hotels',
      basePrice: 45000,
      currency: 'XAF',
      duration: '2h 15m',
      vehicleClasses: [
        { id: 'comfort', name: 'Comfort Sedan (AC)', capacity: '4 Pax', icon: '🚙', price: 45000 },
        { id: 'vip', name: 'Toyota Prado VIP 4x4', capacity: '5 Pax', icon: '🚘', price: 75000 }
      ]
    }
  ],

  // 6. Tourism & Holiday Packages
  packages: [
    {
      id: 'pkg-1',
      slug: 'kribi-beach-lobe-falls-escape',
      title: 'Kribi Beach & Lobé Waterfalls Escape',
      destination: 'Kribi, South Region, Cameroon',
      duration: '3 Days / 2 Nights',
      durationDays: 3,
      price: 120000,
      currency: 'XAF',
      rating: 4.9,
      reviewsCount: 86,
      organizer: 'Cameroon Discovery Tours (Licensed)',
      badge: 'POPULAR WEEKEND',
      highlights: ['Beachfront Luxury Lodge', 'Canoe Ride to Lobé Falls', 'Fresh Seafood Dinner', 'Pygmy Village Walk'],
      itinerary: [
        { day: 1, title: 'Arrival & Grand Batanga Sunset', details: 'Private pickup from Douala/Yaoundé, check-in at Tara Plage Resort, welcome tropical cocktail, beach seafood barbecue.' },
        { day: 2, title: 'Lobé Waterfalls & Indigenous Culture', details: 'Morning traditional pirogue excursion to where waterfalls cascade into the ocean. Cultural encounter with the Bagyeli community.' },
        { day: 3, title: 'Lighthouse & Return', details: 'Visit to Kribi historic German lighthouse, fresh fish market souvenir stop, scenic transfer back.' }
      ],
      included: ['2 Nights Beachfront Hotel', 'Breakfast & Seafood Dinner', 'Private Air-Conditioned Transport', 'Guided Tours & Park Entry Fees'],
      excluded: ['Personal Alcoholic Beverages', 'Optional Jet Ski Rental'],
      meetingPoint: 'Douala (Akwa) or Yaoundé (Bastos)'
    },
    {
      id: 'pkg-2',
      slug: 'limbe-botanic-mount-cameroon-hike',
      title: 'Limbe Botanic & Mount Cameroon Hike',
      destination: 'Limbe & Buea, South West, Cameroon',
      duration: '2 Days / 1 Night',
      durationDays: 2,
      price: 75000,
      currency: 'XAF',
      rating: 4.8,
      reviewsCount: 64,
      organizer: 'Fako Mountain Adventures',
      badge: 'NATURE & ADVENTURE',
      highlights: ['Limbe Botanical Gardens (1892)', 'Mount Cameroon Lava Flow Hike', 'Black Sand Beach Relaxation', 'Wildlife Centre Visit'],
      itinerary: [
        { day: 1, title: 'Limbe Coast & Botanic Heritage', details: 'Departure from Douala, guided tour of Limbe Botanic Garden, Limbe Wildlife Centre primate sanctuary, evening at Down Beach.' },
        { day: 2, title: 'Mount Cameroon Slope Hike', details: 'Scenic morning hike to the 1999 lava flow in Bakingili with a certified mountain ranger, fresh roast fish lunch, afternoon return.' }
      ],
      included: ['1 Night Coastal Lodge', 'All Meals & Mineral Water', 'Licensed Mountain Ranger', 'Transport from Douala'],
      excluded: ['Mountain Climbing Boots (Available for Rent)', 'Tips']
    },
    {
      id: 'pkg-3',
      slug: 'rhumsiki-kapsiki-cultural-peaks',
      title: 'Rhumsiki Cultural Peaks & Mandara Mountains',
      destination: 'Far North Region, Cameroon',
      duration: '4 Days / 3 Nights',
      durationDays: 4,
      price: 260000,
      currency: 'XAF',
      rating: 4.9,
      reviewsCount: 42,
      organizer: 'Sahel Eco-Tours',
      badge: 'CULTURAL EXPEDITION',
      highlights: ['Volcanic Plug Landscapes', 'Crab Sorcerer Consultation', 'Artisanal Weavers of Rhumsiki', 'Gorges de Kola Stop'],
      itinerary: [
        { day: 1, title: 'Flight to Maroua & Kola Gorges', details: 'Flight arrival in Maroua, transfer to Gorges de Kola monumental rocks, check-in at Campement de Rhumsiki.' },
        { day: 2, title: 'Rhumsiki Needle & Traditional Crafts', details: 'Sunrise hike around the volcanic plug, consultation with the traditional crab sorcerer, brass-smiths workshop.' },
        { day: 3, title: 'Kapsiki Villages & Mandara Trek', details: 'Gentle hiking through terrace farming landscapes and ancestral stone compounds.' },
        { day: 4, title: 'Maroua Artisan Market & Return', details: 'Maroua leathercraft and embroidery market, transfer to Maroua Salak Airport.' }
      ],
      included: ['3 Nights Campement / Hotel', 'All Regional 4x4 Transport', 'Local English/French Guide', 'All Meals'],
      excluded: ['Domestic Flights (Can be bundled)']
    }
  ],

  // 7. Visa & Consular Concierge
  visaDestinations: [
    {
      id: 'visa-fr',
      country: 'France / Schengen Area',
      flag: '🇫🇷',
      types: ['Short-stay Tourism (Type C)', 'Business Visa', 'Long-stay Student (VLS-TS)'],
      officialFee: 52500, // ~80 EUR
      conciergeFee: 25000,
      totalEstimatedFee: 77500,
      currency: 'XAF',
      processingDays: '15 to 21 working days',
      requirements: [
        'Valid Passport (at least 6 months validity from return date)',
        '3 Recent Bank Statements (Certified by local bank)',
        'Proof of Accommodation / Hotel Booking or Attestation d’accueil',
        'Roundtrip Flight Reservation (Provided by LOUMOO)',
        'Compliant Travel & Medical Insurance (€30,000 coverage)',
        'Employment Letter or Business Registration (RCCM)'
      ],
      appointmentCenter: 'TLScontact Douala / Yaoundé'
    },
    {
      id: 'visa-usa',
      country: 'United States of America',
      flag: '🇺🇸',
      types: ['B1/B2 Visitor & Tourism', 'F1 Academic Student', 'C1/D Transit & Crew'],
      officialFee: 115000, // $185 MRV fee
      conciergeFee: 35000,
      totalEstimatedFee: 150000,
      currency: 'XAF',
      processingDays: 'Appointment-dependent + 3-5 days after interview',
      requirements: [
        'DS-160 Confirmation Page & Barcode',
        'Valid Passport with at least 2 blank pages',
        '5x5 cm Color Photo (White background)',
        'Proof of Financial Solvency & Ties to Cameroon',
        'Purpose of Travel Letter'
      ],
      appointmentCenter: 'US Embassy Yaoundé (Rosa Parks Avenue)'
    },
    {
      id: 'visa-uae',
      country: 'United Arab Emirates (Dubai)',
      flag: '🇦🇪',
      types: ['30 Days Single Entry', '60 Days Tourist', '96 Hours Transit'],
      officialFee: 65000,
      conciergeFee: 20000,
      totalEstimatedFee: 85000,
      currency: 'XAF',
      processingDays: '3 to 5 working days (E-Visa)',
      requirements: [
        'Clear Passport Bio Page Scan',
        'Passport Photo (White background)',
        'Confirmed Return Flight Ticket',
        'Hotel Booking Confirmation'
      ],
      appointmentCenter: '100% Digital E-Visa (No Embassy Visit Required)'
    },
    {
      id: 'visa-ca',
      country: 'Canada',
      flag: '🇨🇦',
      types: ['Visitor Visa (TRV)', 'Study Permit', 'Super Visa for Parents'],
      officialFee: 75000, // 100 CAD + 85 CAD biometrics
      conciergeFee: 35000,
      totalEstimatedFee: 110000,
      currency: 'XAF',
      processingDays: '30 to 60 working days',
      requirements: [
        'Valid Passport',
        'Biometrics at VFS Global Yaoundé',
        'Bank Statements (Past 4 months)',
        'Letter of Explanation / Purpose of Travel',
        'Proof of Ties (Property, Employment, Family)'
      ],
      appointmentCenter: 'VFS Global Yaoundé'
    }
  ],

  // 7. Destinations & Geo Coordinates
  destinations: [
    {
      id: 'dst-douala',
      name: 'Douala',
      city: 'Douala',
      country: 'Cameroon',
      latitude: 4.051056,
      longitude: 9.767868,
      image: 'https://images.unsplash.com/photo-1577717903315-1691ae25ab3f?w=600&auto=format&fit=crop&q=80',
      popular: true,
      tagline: 'Economic capital & vibrant seaport'
    },
    {
      id: 'dst-yaounde',
      name: 'Yaoundé',
      city: 'Yaoundé',
      country: 'Cameroon',
      latitude: 3.8480,
      longitude: 11.5021,
      image: 'https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=600&auto=format&fit=crop&q=80',
      popular: true,
      tagline: 'City of seven hills & political hub'
    },
    {
      id: 'dst-kribi',
      name: 'Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.9390,
      longitude: 9.9100,
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80',
      popular: true,
      tagline: 'White sand beaches & Lobé waterfalls'
    },
    {
      id: 'dst-limbe',
      name: 'Limbé',
      city: 'Limbé',
      country: 'Cameroon',
      latitude: 4.0167,
      longitude: 9.2167,
      image: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=600&auto=format&fit=crop&q=80',
      popular: true,
      tagline: 'Volcanic black sands & botanic gardens'
    },
    {
      id: 'dst-bafoussam',
      name: 'Bafoussam',
      city: 'Bafoussam',
      country: 'Cameroon',
      latitude: 5.4778,
      longitude: 10.4176,
      image: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&auto=format&fit=crop&q=80',
      popular: false,
      tagline: 'Western highlands, chieftancies & culture'
    },
    {
      id: 'dst-ngaoundere',
      name: 'Ngaoundéré',
      city: 'Ngaoundéré',
      country: 'Cameroon',
      latitude: 7.3195,
      longitude: 13.5843,
      image: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&auto=format&fit=crop&q=80',
      popular: false,
      tagline: 'Northern plateau & Camrail terminus'
    },
    {
      id: 'dst-maroua',
      name: 'Maroua',
      city: 'Maroua',
      country: 'Cameroon',
      latitude: 10.5956,
      longitude: 14.3247,
      image: 'https://images.unsplash.com/photo-1516426122078-c23e76319801?w=600&auto=format&fit=crop&q=80',
      popular: true,
      tagline: 'Sahelian gateway & Waza National Park'
    }
  ],

  // 8. Travel Providers (Unified Registry)
  travelProviders: [
    {
      id: 'prv-krystal',
      name: 'Krystal Palace Douala',
      type: 'hotel',
      logo: '🏨',
      description: 'First 5-star luxury hotel in Douala with rooftop infinity pool and Michelin-inspired dining',
      contact: { phone: '+237 233 42 00 00', email: 'concierge@krystalpalace.cm', address: 'Boulevard de la Liberté, Akwa, Douala' },
      rating: 4.9,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-starland',
      name: 'Star Land Hotel Bastos',
      type: 'hotel',
      logo: '🏨',
      description: 'Exclusive 4-star boutique hotel located in the diplomatic quarter of Bastos, Yaoundé',
      contact: { phone: '+237 222 20 60 60', email: 'reservation@starlandhotel.com', address: 'Rue 1.792, Bastos, Yaoundé' },
      rating: 4.8,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-montfebe',
      name: 'Hôtel Mont Fébé',
      type: 'hotel',
      logo: '🏨',
      description: 'Panoramic hillside luxury overlooking Yaoundé with adjacent golf course',
      contact: { phone: '+237 222 21 40 02', email: 'booking@hotel-montfebe.com', address: 'Colline du Mont Fébé, Yaoundé' },
      rating: 4.6,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-ilomba',
      name: 'Hôtel Ilomba Kribi',
      type: 'hotel',
      logo: '🏖️',
      description: 'Eco-chic beachfront lodge located close to the legendary Lobé waterfalls',
      contact: { phone: '+237 699 80 12 34', email: 'info@ilomba.com', address: 'Grand Batanga, Kribi' },
      rating: 4.8,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-fini',
      name: 'Fini Hotel Bobende Limbe',
      type: 'hotel',
      logo: '🌊',
      description: 'Seaside resort on the Atlantic coast overlooking Mount Cameroon slopes',
      contact: { phone: '+237 233 33 25 14', email: 'contact@finihotel.cm', address: 'Bobende Ocean Road, Limbe' },
      rating: 4.5,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-goldenhaven',
      name: 'Golden Haven Retreat',
      type: 'hotel',
      logo: '🏨',
      description: 'Boutique garden retreat in Bonapriso with organic interiors and a rooftop bar',
      contact: { phone: '+237 233 42 71 10', email: 'stay@goldenhaven.cm', address: 'Rue Njo-Njo, Bonapriso, Douala' },
      rating: 4.8,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-phare',
      name: 'Hôtel du Phare',
      type: 'hotel',
      logo: '🌊',
      description: 'Oceanfront hotel on the Kribi shore with sunset terraces and a seafood kitchen',
      contact: { phone: '+237 233 46 15 30', email: 'reservation@hotelduphare.cm', address: 'Atlantic Shore, Kribi' },
      rating: 4.8,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-jully',
      name: 'Résidence JULLY',
      type: 'hotel',
      logo: '🌴',
      description: 'Seaside villa residence near the Lobé Falls with kitchenette suites',
      contact: { phone: '+237 677 84 22 019', email: 'contact@residencejully.cm', address: 'Lobé Waterfalls Coast, Kribi' },
      rating: 4.7,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-gites',
      name: 'Les Gîtes de Kribi',
      type: 'hotel',
      logo: '🏖️',
      description: 'Beach cabins on Plage Tara with a nightly grilled-fish restaurant',
      contact: { phone: '+237 699 31 07 44', email: 'bonjour@gitesdekribi.cm', address: 'Plage Tara, Kribi' },
      rating: 4.6,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-oceanfront',
      name: 'Kribi Oceanfront Lodge',
      type: 'hotel',
      logo: '🌊',
      description: 'Modern beach-boulevard lodge minutes from the Kribi deep-water port',
      contact: { phone: '+237 233 46 20 88', email: 'stay@kribioceanfront.cm', address: 'Boulevard de la Plage, Kribi' },
      rating: 4.5,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-bastos',
      name: 'Bastos Panoramic Suites',
      type: 'hotel',
      logo: '🏙️',
      description: 'Business suites above the Yaoundé diplomatic quarter with a rooftop pool',
      contact: { phone: '+237 222 21 44 90', email: 'reservation@bastossuites.cm', address: 'Bastos, Yaoundé' },
      rating: 4.7,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-relais',
      name: 'Hôtel Le Relais',
      type: 'hotel',
      logo: '🏜️',
      description: 'Courtyard hotel with Sahelian character in central Maroua, Far North',
      contact: { phone: '+237 222 29 13 05', email: 'accueil@lerelaismaroua.cm', address: 'Maroua Central, Far North' },
      rating: 4.6,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-zingana',
      name: 'Hôtel Zingana',
      type: 'hotel',
      logo: '🏔️',
      description: 'Modern luxury comfort in the heart of Bafoussam western highlands',
      contact: { phone: '+237 233 44 11 22', email: 'reservation@hotelzingana.cm', address: 'Avenue de la République, Bafoussam' },
      rating: 4.7,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-general-express',
      name: 'General Express Voyages',
      type: 'bus',
      logo: '🚌',
      description: 'Premier intercity coach operator serving Douala, Yaoundé, and western corridors',
      contact: { phone: '+237 677 00 11 22', email: 'support@generalexpress.cm' },
      rating: 4.7,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-finexs',
      name: 'Finexs Voyages',
      type: 'bus',
      logo: '🚌',
      description: 'Exclusive executive VIP express coach line between Douala and Yaoundé',
      contact: { phone: '+237 690 12 34 56', email: 'booking@finexs.cm' },
      rating: 4.9,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-touristique',
      name: 'Touristique Express',
      type: 'bus',
      logo: '🚌',
      description: 'Nationwide VIP carrier connecting southern hubs to the northern provinces',
      contact: { phone: '+237 699 33 44 55', email: 'contact@touristiqueexpress.cm' },
      rating: 4.8,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-camrail',
      name: 'Camrail (Bolloré Railways)',
      type: 'train',
      logo: '🚆',
      description: 'Official national railway of Cameroon operating Transcam intercity and sleeper services',
      contact: { phone: '+237 233 50 25 00', email: 'voyageurs@camrail.net' },
      rating: 4.6,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-camairco',
      name: 'Camair-Co (The Star of Cameroon)',
      type: 'flight',
      logo: '✈️',
      description: 'National flag carrier operating domestic flights and CEMAC regional connections',
      contact: { phone: '+237 233 42 20 10', email: 'callcenter@camair-co.cm' },
      rating: 4.4,
      verificationStatus: 'VERIFIED'
    },
    {
      id: 'prv-discovery-tours',
      name: 'Cameroon Discovery Tours',
      type: 'excursion',
      logo: '🧭',
      description: 'Licensed national ecotourism, mountain guiding, and coastal expedition specialist',
      contact: { phone: '+237 670 99 88 77', email: 'hello@cameroondiscovery.cm' },
      rating: 4.9,
      verificationStatus: 'VERIFIED'
    }
  ],

  // 9. Hotels & Real Room Tiers
  hotels: [
    {
      id: 'htl-krystal-douala',
      starLabel: '5-Star Luxury',
      providerId: 'prv-krystal',
      name: 'Krystal Palace Douala',
      phone: '+237699112233',
      whatsapp: '+237699112233',
      description: 'The standard of 5-star hospitality in Douala. Located in Akwa, offering panoramic ocean & city views, spa wellness, and high-speed fiber connectivity.',
      location: 'Boulevard de la Liberté, Akwa, Douala',
      city: 'Douala',
      country: 'Cameroon',
      latitude: 4.0515,
      longitude: 9.7025,
      rating: 4.9,
      priceFrom: 95000,
      currency: 'XAF',
      amenities: ['Free High-Speed Wi-Fi', 'Rooftop Infinity Pool', 'Spa & Hammam', 'Fitness Centre', 'Airport Shuttle', 'Fine Dining Restaurant', '24/7 Room Service', 'Business Lounge'],
      images: [
        './Assets/Travel&Hotel/Krystal Palace Hotel Douala.jfif',
        'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=700&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=700&auto=format&fit=crop&q=80'
      ],
      // Immersive 360° virtual tour of the whole property, plus per-space entry
      // points. A hotel manager fills these in via the "For Hotels" upload;
      // guests explore the property inside LOUMOO before they book.
      virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/',
      spaces: [
        {
          name: 'Grand Lobby & Reception',
          category: 'Lobby',
          description: 'Double-height marble lobby with a curated art wall and 24/7 concierge.',
          image: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&auto=format&fit=crop&q=80',
          amenities: ['Concierge', 'Welcome Lounge', 'Art Wall'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        },
        {
          name: 'Rooftop Infinity Pool',
          category: 'Pool',
          description: 'Heated infinity pool on the 12th floor with panoramic Wouri estuary views.',
          image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&auto=format&fit=crop&q=80',
          amenities: ['Infinity Edge', 'Pool Bar', 'Sun Deck'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        },
        {
          name: 'Le Panorama Restaurant',
          category: 'Restaurant',
          description: 'Signature fine-dining room pairing Cameroonian produce with French technique.',
          image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&auto=format&fit=crop&q=80',
          amenities: ['Fine Dining', 'Wine Cellar', 'Private Booths'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        },
        {
          name: 'Wellness Spa & Hammam',
          category: 'Spa',
          description: 'Full-service spa with hammam, steam rooms and five treatment suites.',
          image: 'https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=600&auto=format&fit=crop&q=80',
          amenities: ['Hammam', 'Sauna', 'Treatment Suites'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        },
        {
          name: 'Executive Port Suite',
          category: 'Suite',
          description: '65m² suite with a separate lounge, executive club access and harbour panorama.',
          image: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&auto=format&fit=crop&q=80',
          amenities: ['Lounge', 'Club Access', 'Balcony'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        }
      ],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-krystal-deluxe',
          hotelId: 'htl-krystal-douala',
          name: 'Deluxe City View Room',
          description: '38m² luxury room with king-size bed, marble bathroom, and floor-to-ceiling city views',
          capacity: 2,
          price: 95000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 8,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Rain Shower', 'Espresso Machine', 'High-Speed Wi-Fi', 'Smart TV 55"'],
          images: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600&auto=format&fit=crop&q=80'],
          virtualTourUrl: 'https://pillows-ghent.virtualtour.nu/'
        },
        {
          id: 'rm-krystal-exec',
          hotelId: 'htl-krystal-douala',
          name: 'Executive Port Suite',
          description: '65m² suite with separate lounge area, executive club access, and harbour panorama',
          capacity: 3,
          price: 165000,
          currency: 'XAF',
          totalInventory: 5,
          availableInventory: 3,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed + Sofa Bed', 'Deep Soaking Tub', 'Executive Lounge Access', 'Balcony', 'Breakfast Included'],
          images: ['https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=600&auto=format&fit=crop&q=80']
        },
        {
          id: 'rm-krystal-presidential',
          hotelId: 'htl-krystal-douala',
          name: 'Presidential Penthouse',
          description: '140m² luxury penthouse with private terrace, meeting room, and dedicated butler',
          capacity: 4,
          price: 450000,
          currency: 'XAF',
          totalInventory: 1,
          availableInventory: 1,
          cancellationPolicy: 'MODERATE_48H',
          amenities: ['2 Bedrooms', 'Private Butler', 'Panoramic Terrace', 'Dining Room', 'VIP Airport Transfer'],
          images: ['https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&auto=format&fit=crop&q=80']
        }
      ]
    },
    {
      id: 'htl-starland-yaounde',
      starLabel: 'Boutique Luxury',
      providerId: 'prv-starland',
      name: 'Star Land Hotel Bastos',
      phone: '+237233424444',
      whatsapp: '+237233424444',
      description: 'Boutique elegance in Yaoundé prestigious Bastos neighborhood. Walk to major embassies, restaurants, and art galleries.',
      location: 'Rue 1.792, Bastos, Yaoundé',
      city: 'Yaoundé',
      country: 'Cameroon',
      latitude: 3.8920,
      longitude: 11.5120,
      rating: 4.8,
      priceFrom: 75000,
      currency: 'XAF',
      amenities: ['Outdoor Pool', 'Complimentary Breakfast', 'Free Wi-Fi', 'Cocktail Bar', 'Meeting Rooms', 'Concierge Service'],
      images: [
        'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=700&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=700&auto=format&fit=crop&q=80'
      ],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-starland-classic',
          hotelId: 'htl-starland-yaounde',
          name: 'Classic Bastos Room',
          description: 'Spacious 32m² room with garden view, queen bed, and quiet working desk',
          capacity: 2,
          price: 75000,
          currency: 'XAF',
          totalInventory: 12,
          availableInventory: 9,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Work Desk', 'En-suite Bathroom', 'Wi-Fi 6', 'Mini Bar'],
          images: ['https://images.unsplash.com/photo-1590490360182-c33d57733427?w=600&auto=format&fit=crop&q=80']
        },
        {
          id: 'rm-starland-suite',
          hotelId: 'htl-starland-yaounde',
          name: 'Ambassador Executive Suite',
          description: '55m² executive suite with separate parlor and VIP amenities',
          capacity: 3,
          price: 130000,
          currency: 'XAF',
          totalInventory: 4,
          availableInventory: 2,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Living Area', 'Espresso Machine', 'Bathtub', 'Complimentary Wine'],
          images: ['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600&auto=format&fit=crop&q=80']
        }
      ]
    },
    {
      id: 'htl-montfebe-yaounde',
      starLabel: 'Hillside Classic',
      providerId: 'prv-montfebe',
      name: 'Hôtel Mont Fébé',
      phone: '+237233424170',
      whatsapp: '+237233424170',
      description: 'Perched atop Mont Fébé with commanding views of the seven hills. Features lush gardens, tennis courts, and peaceful elevation.',
      location: 'Colline du Mont Fébé, Yaoundé',
      city: 'Yaoundé',
      country: 'Cameroon',
      latitude: 3.9140,
      longitude: 11.4980,
      rating: 4.6,
      priceFrom: 65000,
      currency: 'XAF',
      amenities: ['Semi-Olympic Pool', 'Tennis Courts', 'Golf Course Proximity', 'Scenic Restaurant', 'Airport Shuttle', 'Free Parking'],
      images: [
        'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=700&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=700&auto=format&fit=crop&q=80'
      ],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-montfebe-standard',
          hotelId: 'htl-montfebe-yaounde',
          name: 'Hillside Superior Room',
          description: 'Bright 30m² room overlooking the wooded slopes of Mount Fébé',
          capacity: 2,
          price: 65000,
          currency: 'XAF',
          totalInventory: 15,
          availableInventory: 12,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Double Bed', 'Mountain Breeze Balcony', 'TV', 'Desk', 'Free Wi-Fi'],
          images: ['https://images.unsplash.com/photo-1566665797739-1674de7a421a?w=600&auto=format&fit=crop&q=80']
        }
      ]
    },
    {
      id: 'htl-ilomba-kribi',
      starLabel: 'Oceanfront',
      providerId: 'prv-ilomba',
      name: 'Hôtel Ilomba Kribi',
      phone: '+237677445566',
      whatsapp: '+237677445566',
      description: 'Charming beachfront resort nestled under coconut palms in Grand Batanga, only 5 minutes from Lobé waterfalls.',
      location: 'Grand Batanga Beachfront, Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.8940,
      longitude: 9.8890,
      rating: 4.8,
      priceFrom: 55000,
      currency: 'XAF',
      amenities: ['Private Beach', 'Open-Air Seafood Grill', 'Canoe & Excursions', 'Bar Tropical', 'Free Wi-Fi', 'Pet Friendly'],
      images: [
        'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=700&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=700&auto=format&fit=crop&q=80'
      ],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-ilomba-bungalow',
          hotelId: 'htl-ilomba-kribi',
          name: 'Oceanfront Wooden Bungalow',
          description: 'Traditional wood and thatch cottage stepping directly onto warm golden sand',
          capacity: 2,
          price: 55000,
          currency: 'XAF',
          totalInventory: 8,
          availableInventory: 6,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Private Ocean Porch', 'Mosquito Netting', 'Ceiling Fan & AC', 'Open-sky Shower'],
          images: ['https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&auto=format&fit=crop&q=80']
        },
        {
          id: 'rm-ilomba-family',
          hotelId: 'htl-ilomba-kribi',
          name: 'Family Garden Villa',
          description: 'Two-bedroom coastal villa surrounded by tropical hibiscus and palm groves',
          capacity: 5,
          price: 110000,
          currency: 'XAF',
          totalInventory: 3,
          availableInventory: 2,
          cancellationPolicy: 'MODERATE_48H',
          amenities: ['1 King Bed + 2 Twin Beds', 'Private Garden Terrace', 'Kitchenette', 'Dining Table', 'Air Conditioned'],
          images: ['https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=600&auto=format&fit=crop&q=80']
        }
      ]
    },
    {
      id: 'htl-fini-limbe',
      starLabel: 'Seaside Resort',
      providerId: 'prv-fini',
      name: 'Fini Hotel Bobende Limbe',
      phone: '+237699556677',
      whatsapp: '+237699556677',
      description: 'Coastal haven on the Atlantic with views of Bioko Island on clear days. Famous for freshly caught sea fish and ocean breezes.',
      location: 'Bobende Road, Limbe',
      city: 'Limbé',
      country: 'Cameroon',
      latitude: 4.0200,
      longitude: 9.1950,
      rating: 4.5,
      priceFrom: 45000,
      currency: 'XAF',
      amenities: ['Swimming Pool', 'Seaside Terrace', 'Conference Hall', 'Bar & Grill', 'Free Parking'],
      images: [
        'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=700&auto=format&fit=crop&q=80'
      ],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-fini-deluxe',
          hotelId: 'htl-fini-limbe',
          name: 'Ocean View Deluxe',
          description: 'Spacious room with balcony facing the volcanic black sand coastline',
          capacity: 2,
          price: 45000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 8,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Sea Balcony', 'AC', 'Satellite TV', 'Free Wi-Fi'],
          images: ['https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=600&auto=format&fit=crop&q=80']
        }
      ]
    },
    {
      id: 'htl-goldenhaven-douala',
      starLabel: 'Boutique Luxury',
      providerId: 'prv-goldenhaven',
      name: 'Golden Haven Retreat',
      phone: '+237690778899',
      whatsapp: '+237690778899',
      description: 'Warm, organic luxury bedrooms around a quiet garden courtyard in Bonapriso, minutes from the business district.',
      location: 'Rue Njo-Njo, Bonapriso, Douala',
      city: 'Douala',
      country: 'Cameroon',
      latitude: 4.0305,
      longitude: 9.7040,
      rating: 4.8,
      priceFrom: 52000,
      currency: 'XAF',
      amenities: ['Rooftop Bar', 'Spa & Sauna', 'Free Wi-Fi', 'Breakfast Buffet', 'Airport Shuttle', 'Gym'],
      images: ['./Assets/Travel&Hotel/Golden Haven Retreat _ Warm Luxury Hotel Bedroom Design with Modern Organic Elegance.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-goldenhaven-suite',
          hotelId: 'htl-goldenhaven-douala',
          name: 'Organic Luxury Suite',
          description: 'King bed with a separate lounge area, natural materials and a private balcony over the courtyard',
          capacity: 3,
          price: 68000,
          currency: 'XAF',
          totalInventory: 6,
          availableInventory: 5,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Lounge Area', 'Breakfast Included', 'Free Wi-Fi', 'AC'],
          images: ['./Assets/Travel&Hotel/Golden Haven Retreat _ Warm Luxury Hotel Bedroom Design with Modern Organic Elegance.jfif']
        },
        {
          id: 'rm-goldenhaven-garden',
          hotelId: 'htl-goldenhaven-douala',
          name: 'Garden Deluxe Room',
          description: 'Queen bed opening onto the planted courtyard, quiet side of the property',
          capacity: 2,
          price: 52000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 8,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Garden View', 'Breakfast Included', 'Free Wi-Fi', 'AC'],
          images: ['./Assets/Travel&Hotel/Golden Haven Retreat _ Warm Luxury Hotel Bedroom Design with Modern Organic Elegance.jfif']
        }
      ]
    },
    {
      id: 'htl-phare-kribi',
      starLabel: 'Oceanfront',
      providerId: 'prv-phare',
      name: 'Hôtel du Phare',
      phone: '+237677334455',
      whatsapp: '+237677334455',
      description: 'Steps from the sand on the Atlantic shore, with sunset terraces and a seafood kitchen built around the daily catch.',
      location: 'Atlantic Shore, Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.9400,
      longitude: 9.9100,
      rating: 4.8,
      priceFrom: 45000,
      currency: 'XAF',
      amenities: ['Private Beach', 'Seafood Restaurant', 'Free Wi-Fi', 'Terrace Bar', 'Airport Transfer', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/Hotel du Phare (Kribi, Cameroun) _ tarifs 2019 mis….jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-phare-ocean',
          hotelId: 'htl-phare-kribi',
          name: 'Ocean Deluxe King Room',
          description: 'King bed with a sea-view balcony directly above the beach',
          capacity: 2,
          price: 65000,
          currency: 'XAF',
          totalInventory: 8,
          availableInventory: 6,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Sea-View Balcony', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Hotel du Phare (Kribi, Cameroun) _ tarifs 2019 mis….jfif']
        },
        {
          id: 'rm-phare-twin',
          hotelId: 'htl-phare-kribi',
          name: 'Coastal Twin Room',
          description: 'Two twin beds with a partial sea view, suited to friends or colleagues travelling together',
          capacity: 2,
          price: 45000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 9,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['2 Twin Beds', 'Partial Sea View', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Hotel du Phare (Kribi, Cameroun) _ tarifs 2019 mis….jfif']
        }
      ]
    },
    {
      id: 'htl-jully-kribi',
      starLabel: 'Seaside Villa',
      providerId: 'prv-jully',
      name: 'Résidence JULLY',
      phone: '+237655223344',
      whatsapp: '+237655223344',
      description: 'A serene seaside villa near the Lobé Falls, made for slow mornings and long stays.',
      location: 'Lobé Waterfalls Coast, Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.8850,
      longitude: 9.9050,
      rating: 4.7,
      priceFrom: 38000,
      currency: 'XAF',
      amenities: ['Beach Access', 'Outdoor Pool', 'Free Wi-Fi', 'Kitchenette', 'Free Parking', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/Residence JULLY Kribi.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-jully-villa',
          hotelId: 'htl-jully-kribi',
          name: 'Villa Suite',
          description: 'King bed with a private terrace and kitchenette, facing the water',
          capacity: 3,
          price: 58000,
          currency: 'XAF',
          totalInventory: 4,
          availableInventory: 3,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Private Terrace', 'Kitchenette', 'Free Wi-Fi', 'AC'],
          images: ['./Assets/Travel&Hotel/Residence JULLY Kribi.jfif']
        },
        {
          id: 'rm-jully-studio',
          hotelId: 'htl-jully-kribi',
          name: 'Garden Studio',
          description: 'Queen bed studio with kitchenette opening onto the garden',
          capacity: 2,
          price: 38000,
          currency: 'XAF',
          totalInventory: 6,
          availableInventory: 5,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Garden View', 'Kitchenette', 'Free Wi-Fi', 'AC'],
          images: ['./Assets/Travel&Hotel/Residence JULLY Kribi.jfif']
        }
      ]
    },
    {
      id: 'htl-gites-kribi',
      starLabel: 'Beach Lodge',
      providerId: 'prv-gites',
      name: 'Les Gîtes de Kribi',
      phone: '+237699001122',
      whatsapp: '+237699001122',
      description: 'Relaxed beach cabins on Plage Tara, with fresh grilled fish served nightly on the sand.',
      location: 'Plage Tara, Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.9530,
      longitude: 9.9080,
      rating: 4.6,
      priceFrom: 32000,
      currency: 'XAF',
      amenities: ['Beachfront', 'Restaurant', 'Free Wi-Fi', 'Free Parking', 'Bar', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/lesgitesdekribi.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-gites-beach',
          hotelId: 'htl-gites-kribi',
          name: 'Beach Cabin Deluxe',
          description: 'King bed cabin with a beachfront terrace, a few steps from the water',
          capacity: 2,
          price: 42000,
          currency: 'XAF',
          totalInventory: 8,
          availableInventory: 7,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Beachfront Terrace', 'Free Wi-Fi', 'Fan', 'Breakfast Included'],
          images: ['./Assets/Travel&Hotel/lesgitesdekribi.jfif']
        },
        {
          id: 'rm-gites-standard',
          hotelId: 'htl-gites-kribi',
          name: 'Standard Cabin',
          description: 'Queen bed cabin set back along the garden path',
          capacity: 2,
          price: 32000,
          currency: 'XAF',
          totalInventory: 12,
          availableInventory: 10,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Garden Path', 'Free Wi-Fi', 'Fan'],
          images: ['./Assets/Travel&Hotel/lesgitesdekribi.jfif']
        }
      ]
    },
    {
      id: 'htl-oceanfront-kribi',
      starLabel: 'Oceanfront',
      providerId: 'prv-oceanfront',
      name: 'Kribi Oceanfront Lodge',
      phone: '+237675889900',
      whatsapp: '+237675889900',
      description: 'A modern lodge on the beach boulevard, minutes from the deep-water port.',
      location: 'Boulevard de la Plage, Kribi',
      city: 'Kribi',
      country: 'Cameroon',
      latitude: 2.9370,
      longitude: 9.9120,
      rating: 4.5,
      priceFrom: 42000,
      currency: 'XAF',
      amenities: ['Sea View', 'Swimming Pool', 'Free Wi-Fi', 'Restaurant', 'Airport Transfer', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/Kribi Hotel.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-oceanfront-panorama',
          hotelId: 'htl-oceanfront-kribi',
          name: 'Panorama Sea Room',
          description: 'King bed with an unobstructed sea view across the boulevard',
          capacity: 2,
          price: 52000,
          currency: 'XAF',
          totalInventory: 8,
          availableInventory: 6,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Full Sea View', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Kribi Hotel.jfif']
        },
        {
          id: 'rm-oceanfront-city',
          hotelId: 'htl-oceanfront-kribi',
          name: 'City Comfort Room',
          description: 'Queen bed facing the boulevard, the quieter and better-value side of the lodge',
          capacity: 2,
          price: 42000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 9,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Boulevard View', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Kribi Hotel.jfif']
        }
      ]
    },
    {
      id: 'htl-bastos-yaounde',
      starLabel: 'Business Luxury',
      providerId: 'prv-bastos',
      name: 'Bastos Panoramic Suites',
      phone: '+237680112233',
      whatsapp: '+237680112233',
      description: 'Elevated suites over the diplomatic quarter, with skyline views and a rooftop pool.',
      location: 'Bastos, Yaoundé',
      city: 'Yaoundé',
      country: 'Cameroon',
      latitude: 3.8955,
      longitude: 11.5085,
      rating: 4.7,
      priceFrom: 44000,
      currency: 'XAF',
      amenities: ['Rooftop Pool', 'Business Lounge', 'Free Wi-Fi', 'Gym', 'Airport Shuttle', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/Yaounde, Cameroon.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-bastos-executive',
          hotelId: 'htl-bastos-yaounde',
          name: 'Panoramic Executive Suite',
          description: 'King bed with a skyline lounge over the diplomatic quarter',
          capacity: 3,
          price: 55000,
          currency: 'XAF',
          totalInventory: 6,
          availableInventory: 5,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Skyline Lounge', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Yaounde, Cameroon.jfif']
        },
        {
          id: 'rm-bastos-deluxe',
          hotelId: 'htl-bastos-yaounde',
          name: 'Diplomat Deluxe Room',
          description: 'Queen bed with a city view, walking distance to the embassies',
          capacity: 2,
          price: 44000,
          currency: 'XAF',
          totalInventory: 10,
          availableInventory: 8,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'City View', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Yaounde, Cameroon.jfif']
        }
      ]
    },
    {
      id: 'htl-relais-maroua',
      starLabel: 'Comfort Stay',
      providerId: 'prv-relais',
      name: 'Hôtel Le Relais',
      phone: '+237692334455',
      whatsapp: '+237692334455',
      description: 'A calm courtyard hotel with Sahelian character in central Maroua, in the Far North.',
      location: 'Maroua Central, Far North',
      city: 'Maroua',
      country: 'Cameroon',
      latitude: 10.5910,
      longitude: 14.3155,
      rating: 4.6,
      priceFrom: 28000,
      currency: 'XAF',
      amenities: ['Courtyard Pool', 'Restaurant', 'Free Wi-Fi', 'Free Parking', 'Airport Transfer', 'Breakfast Included'],
      images: ['./Assets/Travel&Hotel/Hotel le relais - Nord Cameroun.jfif'],
      status: 'ACTIVE',
      rooms: [
        {
          id: 'rm-relais-courtyard',
          hotelId: 'htl-relais-maroua',
          name: 'Courtyard Suite',
          description: 'King bed opening onto the shaded interior courtyard',
          capacity: 3,
          price: 38000,
          currency: 'XAF',
          totalInventory: 5,
          availableInventory: 4,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['King Bed', 'Courtyard View', 'Breakfast Included', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Hotel le relais - Nord Cameroun.jfif']
        },
        {
          id: 'rm-relais-standard',
          hotelId: 'htl-relais-maroua',
          name: 'Standard Room',
          description: 'Queen bed facing the garden, the most affordable room in the house',
          capacity: 2,
          price: 28000,
          currency: 'XAF',
          totalInventory: 12,
          availableInventory: 11,
          cancellationPolicy: 'FREE_CANCELLATION_24H',
          amenities: ['Queen Bed', 'Garden View', 'AC', 'Free Wi-Fi'],
          images: ['./Assets/Travel&Hotel/Hotel le relais - Nord Cameroun.jfif']
        }
      ]
    }
  ],

  // 10. Excursions & Day Tours
  excursions: [
    {
      id: 'exc-lobe-falls',
      providerId: 'prv-discovery-tours',
      title: 'Lobé Waterfalls & Bagyeli Pygmy Cultural Encounter',
      destination: 'Kribi',
      description: 'Experience one of the only waterfalls in the world that empties directly into the Atlantic ocean. Pirogue ride, fresh giant prawns on the beach, and cultural dialogue.',
      duration: '1 Day',
      price: 35000,
      currency: 'XAF',
      images: [
        'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=700&auto=format&fit=crop&q=80'
      ],
      highlights: ['Lobé Waterfall Canoe Safari', 'Beachside Grilled Giant Prawns (Crevettes)', 'Bagyeli Rainforest Walk', 'German Lighthouse Visit'],
      included: ['Licensed Guide', 'Pirogue Boat Ride', 'Seafood Lunch & Fresh Coconut', 'All Conservation Fees'],
      availableSlots: 24,
      status: 'ACTIVE'
    },
    {
      id: 'exc-mount-cameroon',
      providerId: 'prv-discovery-tours',
      title: 'Mount Cameroon Lava Trail Day Trek',
      destination: 'Limbé & Buea',
      description: 'Hike through misty tropical rainforest to the active 1999 lava flow on the slopes of West Africa highest peak (Mount Fako, 4,040m).',
      duration: '1 Day',
      price: 45000,
      currency: 'XAF',
      images: [
        'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=700&auto=format&fit=crop&q=80'
      ],
      highlights: ['Mount Fako 1999 Lava Flow', 'Tropical Rainforest Canopy', 'Limbe Botanical Garden Visit', 'Black Sand Beach Sunset'],
      included: ['Certified Mountain Guide', 'Park Entry & Porter', 'Picnic Lunch & Water', 'Transport from Douala/Limbe'],
      availableSlots: 16,
      status: 'ACTIVE'
    },
    {
      id: 'exc-waza-safari',
      providerId: 'prv-discovery-tours',
      title: 'Waza National Park Wildlife Safari',
      destination: 'Maroua & Waza',
      description: '2-Day UNESCO biosphere reserve safari tracking elephants, giraffes, lions, and hundreds of migratory bird species across the northern savanna.',
      duration: '2 Days / 1 Night',
      price: 180000,
      currency: 'XAF',
      images: [
        'https://images.unsplash.com/photo-1516426122078-c23e76319801?w=700&auto=format&fit=crop&q=80'
      ],
      highlights: ['Elephant Herd Tracking', 'Giraffe & Antelope Watering Holes', 'Savanna Sunset at Campement de Waza', 'Local Kotoko Village Visit'],
      included: ['4x4 Safari Vehicle with Fuel', 'Eco-guard Guide', '1 Night Safari Camp Lodge', 'All Meals & Mineral Water'],
      availableSlots: 10,
      status: 'ACTIVE'
    }
  ]
};

module.exports = travelData;
