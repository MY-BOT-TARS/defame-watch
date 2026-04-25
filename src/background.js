// DefameWatch Background Service Worker (MV3)
// Listens for messages from content script and manages storage.

// Message types from content script:
const MSG_TYPES = {
  PLACE_VISITED: 'PLACE_VISITED',
  GET_STORED_PLACES: 'GET_STORED_PLACES',
  CLEAR_STORED_PLACES: 'CLEAR_STORED_PLACES'
};

// Default storage schema
const DEFAULT_PLACE = {
  placeId: null,
  name: null,
  address: null,
  totalReviews: null,
  removalRange: null,       // { min: 21, max: 50 }
  recentReviews: null,      // number of reviews in last 365 days
  banningRateMin: null,     // lowest possible banning rate
  banningRateMax: null,     // highest possible banning rate
  visitedAt: null,          // ISO timestamp
};

// ── Storage helpers ───────────────────────────────────────────────────────────

/**
 * Load all stored places from Chrome storage.
 * @returns {Promise<Record<string, object>>}
 */
async function loadPlaces() {
  const result = await chrome.storage.local.get(['places']);
  return result.places || {};
}

/**
 * Persist places dict to Chrome storage.
 * @param {Record<string, object>} places
 */
async function savePlaces(places) {
  await chrome.storage.local.set({ places });
}

// ── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const { type, payload } = message;

    switch (type) {
      case MSG_TYPES.PLACE_VISITED: {
        const places = await loadPlaces();
        const placeId = payload.placeId;
        places[placeId] = {
          ...DEFAULT_PLACE,
          ...(places[placeId] || {}),
          ...payload,
          visitedAt: new Date().toISOString(),
        };
        await savePlaces(places);
        sendResponse({ ok: true });
        break;
      }

      case MSG_TYPES.GET_STORED_PLACES: {
        const places = await loadPlaces();
        sendResponse({ places });
        break;
      }

      case MSG_TYPES.CLEAR_STORED_PLACES: {
        await savePlaces({});
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();
  return true; // Keep channel open for async response
});
