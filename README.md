# DefameWatch

**Chrome extension that reveals the true review quality behind Google Maps ratings.**

> In Germany, business owners can request removal of Google reviews that they claim constitute defamation under German law (§ 189 StGB). Google now displays a notice when reviews have been removed for this reason — but only as a vague range with no context.
>
> **DefameWatch** calculates the actual *banning rate*: how many of the recent reviews were removed, expressed as a percentage. A place with 100 recent reviews and 21–50 removed reviews doesn't have a 4.5-star rating. It has a serious problem.

---

## How it works

1. Open any place page on Google Maps
2. DefameWatch detects the **defamation removal notice** and extracts the range
3. It counts **reviews published in the last 365 days** from the page
4. It calculates the **banning rate**: `removed / (removed + recent)`
5. A **badge** is injected into the page showing the rate (e.g. `⚠️ DefameWatch: 17–33% banning rate`)
6. The place is logged to the **popup history** for later review

---

## Banning rate formula

```
banning_rate = removal_range / (removal_range + recent_reviews_in_365_days)
```

- Removal data is **unambiguous**: Google counts only un-contested defamation removals from the last 365 days (excludes reversals, other legal removals, and policy violations)
- The **range** accounts for Google's intentionally vague bucketed disclosure
- Recent review count is estimated from review timestamps visible on the page

---

## Installing

> ⚠️ This extension is not yet published on the Chrome Web Store. Load it as an unpacked extension.

### Developer install

```bash
# Clone the repo
git clone https://github.com/MY-BOT-TARS/defame-watch.git
cd defame-watch

# Load in Chrome:
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked"
# 4. Select the project folder
```

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Store visited places locally |
| `activeTab` | Access the active tab to read place data |
| `scripting` | Inject the badge into the Maps page |
| `https://*.google.com/maps/*` | Runs only on Google Maps URLs |

No data is sent anywhere. Everything stays on your device.

---

## How to contribute

1. Clone the repo
2. Make changes
3. Open a PR with a clear description

---

## Status

**Early MVP.** The DOM parsing is based on Google Maps' current UI structure. Google's UI changes frequently — if the extension stops working, the likely cause is that Google updated their HTML structure or CSS class names. File an issue with the details and I'll patch it.

Known rough edges:
- Recent review count extraction from the DOM is approximate (relies on visible timestamps)
- Only supports German-language Google Maps (DE locale) for now — other locales use different text patterns
- Badge injection point may need adjustment as Google updates their sidebar layout

---

## License

MIT
