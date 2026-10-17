/**
 * LOUMOO API rate limits.
 * ---------------------------------------------------------------------------
 * RateLimitService counts a request against up to two buckets: the CLIENT's
 * (`req.ip`, the per-user budget: `maxRequests`) and, behind a trusted proxy, the
 * immediate PEER's (the ingress every request arrives through: `peerMaxRequests`).
 *
 * The peer bucket is an abuse backstop for spoofed forwarding headers, so it has to
 * be far above the client budget. Left at its default it EQUALS the client budget:
 * on Railway/Vercel every user reaches the API through the same ingress peer, so the
 * whole site, not one user, shared a single 120-requests-a-minute allowance. A dozen
 * people checking out (about ten API calls per screen, plus the rider hub polling
 * every 15 s and posting GPS every 6 s) were enough for everyone to start getting
 * 429s, which the screens show as "temporarily unavailable" or as an error card.
 */
'use strict';

const PEER_MAX_REQUESTS = 3000;

module.exports = Object.freeze({
  PEER_MAX_REQUESTS,
  api: Object.freeze({ maxRequests: 120, peerMaxRequests: PEER_MAX_REQUESTS, windowSeconds: 60 }),
  discovery: Object.freeze({ maxRequests: 180, peerMaxRequests: PEER_MAX_REQUESTS, windowSeconds: 60, keyPrefix: 'discovery' }),

  // AI/voice search tiers. These endpoints call paid providers (Anthropic for
  // intent/visual, ElevenLabs for the voice agent) so they are metered tightly
  // PER AUTHENTICATED USER, not per IP — the search router keys them by userId.
  // No peerMaxRequests: the peer backstop guards IP-keyed limits against spoofed
  // forwarding headers; a user-keyed budget behind requireAuth has no such hole.
  // searchAssistant + searchDaily stack on /assistant and /visual (a short burst
  // window and a daily ceiling); searchVoice caps session mints on /voice/session.
  searchAssistant: Object.freeze({ maxRequests: 10, windowSeconds: 60, keyPrefix: 'search:paid' }),
  searchDaily: Object.freeze({ maxRequests: 100, windowSeconds: 86400, keyPrefix: 'search:daily' }),
  searchVoice: Object.freeze({ maxRequests: 3, windowSeconds: 60, keyPrefix: 'search:voice' }),

  // In-app messaging: sends and conversation openings, PER AUTHENTICATED USER.
  // Generous for a real chat (a message every two seconds), tight enough that a
  // script cannot flood a seller's inbox. Reading a thread is not metered here;
  // its polling is covered by the general api budget.
  messagingSend: Object.freeze({ maxRequests: 30, windowSeconds: 60, keyPrefix: 'messaging:send' })
});
