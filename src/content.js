// DefameWatch Content Script
// Runs on Google Maps pages. Extracts removal data, calculates banning rate,
// injects a badge, and stores the result via the background service worker.

const MSG_TYPES = {
  PLACE_VISITED: 'PLACE_VISITED',
};

// ── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  // How often to re-scan in ms (e.g. when user navigates between places)
  RESCAN_INTERVAL_MS: 1500,
  // MutationObserver subtree ignored if no new relevant nodes in ms
  QUIESCE_MS: 500,
};

// ── Utility: DOM parsing ────────────────────────────────────────────────────

/**
 * Wait for an element matching `selector` to appear.
 * @param {string} selector
 * @param {Element} root
 * @param {number} timeoutMs
 */
async function waitFor(selector, root = document, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const el = root.querySelector(selector);
    if (el) { resolve(el); return; }
    const mo = new MutationObserver((_, obs) => {
      const el = root.querySelector(selector);
      if (el) { obs.disconnect(); resolve(el); }
    });
    mo.observe(root, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); reject(new Error(`waitFor timed out: ${selector}`)); }, timeoutMs);
    obs.observe(root, { childList: true, subtree: true });
  });
}

/**
 * Try to find text matching a removal range, e.g. "21 bis 50".
 * Returns null if no match found.
 * @returns {{ min: number, max: number } | null}
 */
function parseRemovalRange() {
  // Match patterns like:
  //   "21 bis 50"  (German)
  //   "21 – 50"    (en dash)
  //   "21-50"      (bare)
  const text = document.body.innerText;
  const patterns = [
    /(\d+)\s*bis\s*(\d+)/i,
    /(\d+)\s*[–\-—]\s*(\d+)/,
    /(\d+)\s*-\s*(\d+)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  }
  return null;
}

/**
 * Find the defamation notice element and check if it has the indicator.
 * Returns the element text if found, null otherwise.
 */
function findDefamationNotice() {
  const selectors = [
    // Main indicator (often an aria-label or visible text block)
    '[aria-label*="defamation"]',
    '[aria-label*="Diffamierung"]',
    '[aria-label*="diffamation"]',
    // The inline warning text
    'div[aria-label*="entfernt"]',
    'div[class*="fontBody"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  // Fallback: scan all text nodes
  const range = parseRemovalRange();
  return range;
}

/**
 * Extract place name and ID from Google Maps URL or DOM.
 * @returns {{ name: string|null, placeId: string|null }}
 */
function extractPlaceMeta() {
  const nameEl = document.querySelector('h1[data-item-id], h1[class*="title"]');
  const name = nameEl ? nameEl.textContent.trim() : null;

  // Place ID from URL
  const url = new URL(location.href);
  const placeId = url.searchParams.get('placeId') || url.searchParams.get('q') || null;

  return { name, placeId };
}

/**
 * Extract total review count from DOM.
 * @returns {number|null}
 */
function extractTotalReviewCount() {
  // e.g. "(755)" near the star rating
  const match = document.body.innerText.match(/\((\d+)\)\s*(?:Rezensionen|reviews?|$)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a Google Maps relative time string to a Date.
 * Handles: "vor 4 Monaten", "5 months ago", "vor einem Jahr", "1 year ago"
 * @param {string} text
 * @returns {Date|null}
 */
function parseRelativeTime(text) {
  if (!text) return null;
  const months = text.match(/(\d+)\s*(?:Monat|month)/i)?.[1];
  if (months) {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(months, 10));
    return d;
  }
  const year = text.match(/ein(?:en)?\s*(?:Jahr|year)/i)?.[0] || text.match(/(\d+)\s*(?:Jahr|year)/i)?.[1];
  if (year) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - (parseInt(year, 10) || 1));
    return d;
  }
  return null;
}

/**
 * Collect up to N review publish times from the page DOM.
 * Looks for time elements and data attributes with ISO timestamps.
 * @param {number} limit
 * @returns {Date[]}
 */
function extractRecentReviewDates(limit = 500) {
  const dates = [];

  // Google Maps embeds review dates in several ways:
  // 1. <span class="badge-list-time">vor 4 Monaten</span>
  // 2. <span aria-label="vor 4 Monaten">
  // 3. data-datetime attributes
  // 4. Time elements with ISO datetime attributes
  const timeEls = document.querySelectorAll(
    'span[class*="time"], span[class*="date"], span[aria-label*="vor"], span[class*="badge"]'
  );

  for (const el of timeEls) {
    if (dates.length >= limit) break;
    const text = el.textContent.trim();
    const date = parseRelativeTime(text);
    if (date) dates.push(date);
  }

  // Also scan for <button> elements with relative time text (newer Google UI)
  const buttons = document.querySelectorAll('button, div[role="button"]');
  for (const btn of buttons) {
    if (dates.length >= limit) break;
    const text = btn.textContent.trim();
    if (text && text.length < 60 && /\d+\s*(?:Monat|week|tag|day|Jahr|year)/i.test(text)) {
      const date = parseRelativeTime(text);
      if (date) dates.push(date);
    }
  }

  return dates;
}

/**
 * Count how many of the extracted dates fall within the last 365 days.
 * @param {Date[]} dates
 * @returns {number}
 */
function countRecentDates(dates) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  return dates.filter(d => d >= cutoff).length;
}

/**
 * Calculate banning rate from removal range and recent review count.
 * @param {{ min: number, max: number }} removalRange
 * @param {number} recentReviews
 * @returns {{ min: number, max: number }} rates as decimals (0.0 – 1.0)
 */
function calcBanningRate(removalRange, recentReviews) {
  if (!removalRange || recentReviews == null || recentReviews <= 0) {
    return { min: 0, max: 0 };
  }
  // Worst case: all removed reviews are the only recent ones (max rate)
  // Best case: removed are a small fraction of all recent reviews (min rate)
  // rate = removed / (removed + recent)
  const min = removalRange.min / (removalRange.min + recentReviews);
  const max = removalRange.max / (removalRange.max + recentReviews);
  return { min: Math.round(min * 100), max: Math.round(max * 100) };
}

// ── Badge injection ───────────────────────────────────────────────────────────

let existingBadge = null;

/**
 * Injects a DefameWatch badge into the place detail panel.
 * @param {{ min: number, max: number }} rate
 */
function injectBadge(rate) {
  // Remove existing badge if any
  if (existingBadge) { existingBadge.remove(); existingBadge = null; }

  // Find a good injection point: after the star rating line in the sidebar
  const container = document.querySelector(
    '[class*="header"], [class*="title"], [class*="section"]'
  );
  if (!container) return;

  const badge = document.createElement('div');
  badge.id = 'defamewatch-badge';
  badge.className = 'defamewatch-badge';

  const label = rate.max === 100
    ? '⚠️ 100% removed (defamation)'
    : `⚠️ DefameWatch: ${rate.min}–${rate.max}% banning rate`;

  badge.innerHTML = `<span class="defamewatch-label">${label}</span>`;

  // Insert after the rating section
  const insertAfter = document.querySelector('[class*="rating"], [class*="score"], [class*="stars"]');
  if (insertAfter && insertAfter.parentNode) {
    insertAfter.parentNode.insertBefore(badge, insertAfter.nextSibling);
  } else {
    container.prepend(badge);
  }

  existingBadge = badge;
}

// ── Main scan logic ──────────────────────────────────────────────────────────

async function scanPage() {
  const meta = extractPlaceMeta();
  if (!meta.placeId && !meta.name) return; // Not a place page

  const removalRange = parseRemovalRange();
  if (!removalRange) return; // No removal data on this place

  const totalReviews = extractTotalReviewCount();
  const reviewDates = extractRecentReviewDates(500);
  const recentCount = countRecentDates(reviewDates);
  const rate = calcBanningRate(removalRange, recentCount);

  // Inject badge
  injectBadge(rate);

  // Persist via background service worker
  chrome.runtime.sendMessage({
    type: MSG_TYPES.PLACE_VISITED,
    payload: {
      placeId: meta.placeId || `unknown-${meta.name}`,
      name: meta.name,
      totalReviews,
      removalRange,
      recentReviews: recentCount,
      banningRateMin: rate.min,
      banningRateMax: rate.max,
    }
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let scanTimer = null;
let mo = null;

function scheduleRescan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanPage, CONFIG.RESCAN_INTERVAL_MS);
}

function startObserver() {
  if (mo) mo.disconnect();
  mo = new MutationObserver((mutations) => {
    // Debounce: if no new nodes for QUIESCE_MS, scan once
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPage, CONFIG.QUIESCE_MS);
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// Start on load
window.addEventListener('load', () => {
  setTimeout(() => {
    scanPage();
    startObserver();
  }, 2000);
});

// Re-scan on popstate (back/forward navigation in Maps SPA)
window.addEventListener('popstate', () => {
  setTimeout(scanPage, 2000);
});
