// DefameWatch Popup Script

const MSG_TYPES = {
  GET_STORED_PLACES: 'GET_STORED_PLACES',
  CLEAR_STORED_PLACES: 'CLEAR_STORED_PLACES',
};

// Banning rate thresholds for color coding
const RATE_THRESHOLDS = {
  HIGH: 15,    // >= 15% → red
  MEDIUM: 5,    // >= 5%  → yellow
};

// ── DOM helpers ─────────────────────────────────────────────────────────────

function rateClass(rateMax) {
  if (rateMax >= RATE_THRESHOLDS.HIGH) return 'high';
  if (rateMax >= RATE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

function formatRate(min, max) {
  if (min === max) return `${min}%`;
  return `${min}–${max}%`;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderPlaces(places) {
  const placesBody = document.getElementById('places-body');
  const placesCount = document.getElementById('places-count');
  const flaggedCount = document.getElementById('flagged-count');

  const list = Object.values(places).sort(
    (a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)
  );

  placesCount.textContent = list.length;
  flaggedCount.textContent = list.filter(p => p.banningRateMax >= RATE_THRESHOLDS.MEDIUM).length;

  if (list.length === 0) {
    placesBody.innerHTML = '<p class="empty-state">No places visited yet.<br>Open Google Maps and visit a place page.</p>';
    return;
  }

  placesBody.innerHTML = list.map(p => `
    <div class="place-item">
      <span class="place-name" title="${p.name || p.placeId}">${p.name || p.placeId}</span>
      <span class="place-rate ${rateClass(p.banningRateMax)}">
        ${p.banningRateMin != null ? formatRate(p.banningRateMin, p.banningRateMax) : '—'}
      </span>
    </div>
  `).join('');
}

// ── Message helpers ──────────────────────────────────────────────────────────

async function loadPlaces() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MSG_TYPES.GET_STORED_PLACES }, (resp) => {
      resolve(resp?.places || {});
    });
  });
}

async function clearPlaces() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: MSG_TYPES.CLEAR_STORED_PLACES }, (resp) => {
      resolve(resp?.ok);
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const places = await loadPlaces();
  renderPlaces(places);

  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (confirm('Clear all visited places?')) {
      await clearPlaces();
      renderPlaces({});
    }
  });
});
