# Barcode System

Reference for Kasero's barcode pipeline end-to-end: identifiers, detection, scanning, rendering, validation, and the database contract. Read this before touching any code in `apps/web/src/hooks/useBarcodeScan.tsx`, `packages/shared/src/barcodes.ts`, `apps/web/src/components/products/LiveBarcodeScanner.tsx`, `apps/web/src/components/products/BarcodeFields.tsx`, `apps/web/src/lib/barcode-render.ts` / `apps/web/src/lib/barcode-print.ts`, or the product write paths in `apps/api/src/app/api/businesses/[businessId]/products/`.

---

## Overview

Kasero's barcode system handles two distinct but related concerns:

1. **Identification** — recognizing a product via a physical label the user scans or via a string they type, and resolving it to a row in `products`.
2. **Generation** — producing printable labels for products that don't come with a retail barcode (handmade goods, prepared food, internal SKUs).

The system must be reliable (scanned values round-trip exactly), consistent (the same product can only exist once per business), and forward-compatible (the data model supports future supplier integrations and external POS sync).

---

## Identifiers

There are three distinct kinds of identifiers in the system. Understanding the difference between them is the most important thing to know before touching any code.

### Retail barcodes

Printed on physical products by the manufacturer (cans, boxes, bottles). These are globally registered via GS1 and are the only identifiers that satisfy the property "two independent users scanning the same physical object produce the same value" — which is what makes them usable as a matching key.

Supported formats, via the html5-qrcode decoder:

- EAN-13, EAN-8 (European/international retail)
- UPC-A, UPC-E (North American retail)
- ITF (Interleaved 2 of 5 — shipping cartons)
- Code 128 (industrial, logistics)
- Code 39, Code 93, Codabar (legacy industrial)
- UPC_EAN_EXTENSION (2/5-digit supplements — rare)

The scanner accepts all of these; the cascade in `detectBarcodeFormat` only derives a subset when validating from a raw string (see below).

### Canonical GTIN

For retail barcodes in the GTIN family (EAN-13, UPC-A, EAN-8, UPC-E — but UPC-E isn't currently expanded), the system computes and stores a 14-digit canonical GTIN by left-padding with zeros. Example:

- UPC-A `012345678905` → GTIN `00012345678905`
- EAN-13 `0012345678905` → GTIN `00012345678905`

Both collapse to the same canonical form, which is how the system deduplicates products across formats. The GTIN is stored in the `products.barcode_gtin` column alongside the user-facing `products.barcode`. It's never shown to users — it's purely a matching key for future integrations (Shopify, Square, supplier shipment reconciliation, etc.) that key on GTIN.

Non-retail formats (Code 128, KSR-, etc.) leave `barcode_gtin` null.

### KSR- codes (internal labels)

Kasero-generated identifiers for products that don't have a retail barcode. Format: `KSR-` + 10 random characters from an unambiguous alphabet (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — no 0/1/O/I confusion, no lowercase).

KSR- codes are:

- **Generated only by `generateInternalProductBarcode()` in `packages/shared/src/barcodes.ts`.** Never manually typed by users.
- **Business-local.** Two different businesses making the same kind of product get different KSR- codes for it. There is no global meaning.
- **Never used for catalog matching.** Because two independent users can't produce the same KSR- code for the same physical product, they can't function as a matching key.
- **Reserved namespace.** The API rejects any attempt to manually write a barcode starting with `KSR-`. See `validateBarcodeSourcePrefix` below.
- **Rendered as Code 128.** bwip-js renders KSR- values in Code 128 because that symbology accepts any printable ASCII.

---

## The detection cascade

`detectBarcodeFormat(value)` in `packages/shared/src/barcodes.ts` is the single source of truth for "what format is this value?" It is called by:

- `BarcodeFields.tsx` on every keystroke in the barcode input field.
- Both product API routes (`POST` and `PATCH`) on every write.

The cascade is a first-match-wins sequence. Input is normalized internally (trim, collapse whitespace, uppercase) before matching.

1. **KSR- prefix** → Code 128. Internal labels always map here, regardless of suffix content.
2. **13 digits + valid check digit** → EAN-13. Computed via `gtinCheckDigit()` using the GS1 standard algorithm.
3. **12 digits + valid check digit** → UPC-A.
4. **8 digits + valid check digit** → EAN-8.
5. **All digits, even length, ≥ 6** → ITF (Interleaved 2 of 5). Requires even length because ITF encodes pairs of digits.
6. **Any printable ASCII** → Code 128. Universal fallback — this is what makes manual entry always produce a renderable barcode.
7. **Otherwise** → `null`. The caller rejects the write.

### Why Code 39 is NOT in the cascade

Code 39 accepts a subset of Code 128's character set (0-9, A-Z, space, `-.$/+%`). Including it in the cascade caused plain numeric strings like `123456789` to be misclassified as Code 39 just because digits are in the Code 39 charset. Code 128 is denser and is the modern default for non-retail barcodes, so Code 39 was removed from the cascade.

Code 39 is still **accepted from the scanner** — if html5-qrcode decodes a real Code 39 label and reports it authoritatively, the system stores it as Code 39. The cascade only controls what we *guess* from a raw string, not what we trust from the decoder.

### Check digit algorithm

`gtinCheckDigit(data)` implements the GS1 standard:

1. Starting from the rightmost data digit, multiply by 3, then 1, then 3, then 1, alternating.
2. Sum the products.
3. Check digit = `(10 - sum % 10) % 10`.

This works for all GTIN lengths (UPC-A has 11 data digits, EAN-13 has 12, EAN-8 has 7) because the algorithm is length-agnostic — it just alternates from the right.

### Canonical GTIN computation

`computeCanonicalGtin(value, format)` in `packages/shared/src/barcodes.ts`:

1. Returns `null` if `value` or `format` is missing, or if `format` is not in the GTIN family.
2. Validates the value as a GTIN (digits only + passing check digit).
3. Returns `value.padStart(14, '0')`.

Called from both product API routes whenever the barcode value or format changes.

---

## Source/prefix validation

`validateBarcodeSourcePrefix(value, source)` enforces a full matrix of allowed combinations between the barcode value's KSR- prefix and its `source` field (`scanned` / `generated` / `manual`).

| Source | Starts with KSR-? | Allowed? | Reason |
|---|---|---|---|
| `generated` | Yes | Yes | The only legitimate generated case |
| `generated` | No | Reject | Generator must produce KSR- values; non-KSR- means the client lied |
| `scanned` | Yes | Reject | Real retail labels never start with KSR- |
| `scanned` | No | Yes | Normal scan path |
| `manual` | Yes | Reject | KSR- is a reserved namespace for the generator only |
| `manual` | No | Yes | Normal manual entry |

Called from both `POST /products` and `PATCH /products/[id]` after format derivation but before the duplicate check.

### Known limitation

In the `PATCH` path, the check only runs when the request explicitly includes a `barcodeSource` field. If the request updates only the barcode value without touching source, the validator is skipped. This is a deliberate trade-off to avoid a database read to fetch the existing source. It's defense-in-depth that loses strictness in a narrow edge case that isn't exploitable in normal use.

---

## API boundary

The product API routes (`POST /products` and `PATCH /products/[id]`) are the chokepoint for barcode data correctness. All barcode-related logic lives in these two files.

### Normalization

`normalizeBarcodeValue(value)` in `packages/shared/src/barcodes.ts` is the canonical form of any barcode value for storage and comparison:

1. Trim outer whitespace
2. Collapse internal whitespace (`\s+` → `""`)
3. Uppercase

Applied:
- To the body `barcode` field on every `POST` and `PATCH`.
- To the `?barcode=` query param on `GET /products`.

**Do not apply to the `barcodeSource` field** — source is a lowercase enum (`scanned`, `generated`, `manual`) and uppercasing it breaks validation. Source is trimmed only.

### Format derivation

The API derives `format` from `value` via `detectBarcodeFormat`. **The client's `barcodeFormat` field is ignored completely** — it's not even in the Zod schema on `POST`, and PATCH silently ignores any `barcodeFormat` field in the FormData.

If the value is non-empty but the cascade returns `null`, the API rejects with `400 Unrecognized barcode value`.

### Duplicate detection

Both routes perform an application-level duplicate check. The check queries:

```
WHERE business_id = X AND barcode = <normalized>
```

If a match is found (other than the row being edited in the PATCH case), the write is rejected with `400 Another product already uses this barcode`.

This is defense in depth on top of the database-level partial unique index (below). Because products are hard-deleted (no archive table), there is no need to exclude archived rows — they don't exist in the DB.

### Canonical GTIN computation

After format derivation and validation, the API computes `barcodeGtin` via `computeCanonicalGtin(value, format)` and stores it on the row.

---

## Database layer

### Schema

`packages/shared/src/db/schema.ts` defines the `products` table with these barcode-related columns:

```
barcode              text nullable
barcode_format       text enum nullable
barcode_source       text enum nullable (scanned | generated | manual)
barcode_gtin         text nullable (14-digit canonical)
```

Indexes:
- `idx_products_barcode` — plain index on `barcode` for fast lookup
- `idx_products_barcode_format` — index on `barcode_format`
- `idx_products_barcode_source` — index on `barcode_source`
- `idx_products_barcode_gtin` — index on `barcode_gtin` for future GTIN-based integrations
- `idx_unique_products_business_barcode` — **partial unique index** on `(business_id, barcode)` with `WHERE barcode IS NOT NULL`

### The partial unique index

The unique constraint excludes null barcodes so products without barcodes don't violate uniqueness. SQLite treats NULLs as distinct in unique indexes, making the `IS NOT NULL` clause technically redundant, but it documents intent.

Products are hard-deleted (no archive/soft-delete), so there is no need to exclude archived rows from the index — deleted rows are simply gone. A product deletion is blocked with a 409 if the product is referenced in any pending order.

---

## The scanner hook

`useBarcodeScan` in `apps/web/src/hooks/useBarcodeScan.tsx` is the top-level API for scanning. It returns:

```ts
{ open: () => void, busy: boolean, hiddenInput: ReactNode }
```

Consumers render `hiddenInput` somewhere in their tree (it's JSX that includes the hidden file input and the conditionally-rendered live scanner overlay) and call `open()` when the user clicks a scan button.

### Device dispatch

On mount, the hook detects the device via `useIsMobile()` (see below) and routes `open()` to one of two paths:

- **Mobile (touch-first device)** → `openLiveScanner()` sets state to mount the `LiveBarcodeScanner` overlay, which opens the camera via `Html5Qrcode.start()`.
- **Desktop (pointer: fine)** → `openFilePicker()` clicks the hidden file input, opening the native OS file picker.

### File-input path (desktop)

When the user picks a file, `handleFile` runs:

1. **Re-entrancy guard** — if `busyRef.current` is true, ignore.
2. **File size limit** — reject files over 20 MB with `ScanErrorKind.FileTooLarge`.
3. **PDF handling** — if the file is a PDF, rasterize page 1 via `rasterizePdfFirstPage` (uses `unpdf`).
4. **HEIC handling** — if the file is HEIC/HEIF, convert to JPEG via the `/api/convert-heic` endpoint.
5. **Decode** — hand the resulting `File` to `Html5Qrcode.scanFileV2()`.
6. **Error handling** — map failures to a discriminated `ScanErrorKind` and surface to the caller.
7. **Result** — call the caller's `onResult` callback with `{ value, format }`. If the callback throws, surface `ScanErrorKind.ResultHandlerError`.
8. **Cleanup** — clear the scanner instance and reset the file input value.

### State hygiene

- Host element IDs use React's `useId()` (sanitized to strip `:` characters) so they're SSR-safe and Strict-Mode-safe. The previous module-level counter has been removed.
- A `useEffect` cleanup destroys any active scanner on unmount so camera streams and orphaned host elements don't leak across page transitions.
- `busyRef` mirrors the `busy` state synchronously so re-entrancy guards work before React has committed the next render.

---

## Live camera scanner

`LiveBarcodeScanner` in `apps/web/src/components/products/LiveBarcodeScanner.tsx` is a full-screen overlay that mounts a `Html5Qrcode` instance, opens the rear camera via `getUserMedia`, and continuously decodes frames. Unlike `scanFileV2`, the live path tries dozens of frames per second and picks the best decode — dramatically more reliable than still-image decoding from a single photo.

### Mount lifecycle

The start-scanner effect runs **once on mount** (empty deps). Props `onResult` and `onError` are stashed in refs (`onResultRef`, `onErrorRef`) that are updated on every render but don't retrigger the effect. This is load-bearing — if the effect depended on prop identity, parents passing inline arrow functions would cause the scanner to restart on every parent re-render, producing the `Maximum update depth exceeded` error.

The cleanup fires `scanner.stop()` and `scanner.clear()` as a fire-and-forget async chain on unmount to release the camera.

### html5-qrcode gotchas

Several subtle behaviors of `Html5Qrcode.start()` are worked around:

1. **`qrbox` is omitted.** When set, html5-qrcode injects its own shaded scan region with corner markers, positioned relative to the letterboxed `<video>` element's rendered size — not our host div. That caused the library's overlay to appear below our centered laser line. Omitting `qrbox` makes the library scan the full frame and skip drawing the shaded region entirely. Our custom corner brackets and laser line are drawn as sibling divs over the video.

2. **Video element sizing is overridden.** html5-qrcode wraps the `<video>` in intermediate divs with inline pixel-based sizing. A scoped `<style>` tag targets the specific host ID and overrides `width`, `height`, `min-height`, `max-height`, and `padding` at every level, plus forces `object-fit: cover` on the video so the camera feed fills the host without letterboxing.

3. **Result callback deduplication.** The library may fire its success callback for multiple consecutive frames seeing the same barcode. A `useRef` guard (`emittedRef`) prevents double-emission.

4. **Error classification.** The library wraps the underlying `getUserMedia` error into a string with the original error name embedded (e.g. `"Error getting userMedia, error = NotAllowedError: Permission denied"`). The Error object may not have a usable `.name` property by the time the catch block runs. Classification uses case-insensitive substring matching on the stringified error, not `err.name` checks.

### Layout

The overlay is `position: fixed` but constrained by `top: calc(var(--header-height) + env(safe-area-inset-top, 0px))` and `bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px))` so the PageHeader and MobileNav remain visible and interactive around the scanner.

### Visual elements

- Backdrop: `bg-black` (intentionally hardcoded — camera viewfinder context is dark regardless of theme, matching platform conventions).
- Close button: top-right, lucide's `X` icon, `text-text-inverse` on a semi-transparent dark backdrop with backdrop-blur.
- Scan frame: four L-shaped corner brackets in `border-text-inverse`, aligned to the corners of a centered `85% × aspect-[3/2]` box with a max-width cap.
- Laser line: full-width inside the scan box, centered vertically, `bg-error` (semantic danger color from the design tokens).
- Footer: gradient-to-black at the bottom with the instruction text and an optional "Choose a file instead" text link.

### The file-picker escape hatch

The scanner exposes an optional `onSwitchToFilePicker` prop. When provided, a "Choose a file instead" text link appears both in the footer (during scanning) and in the error state. Clicking it dismisses the overlay and synchronously triggers the hidden file input via `inputRef.current?.click()` — synchronously is critical so the browser's user-activation gesture is preserved and the file dialog is allowed to open.

This serves two real use cases:

1. **Mobile users with PDFs or pre-taken photos.** They can bail out of the live camera and upload a file from their library instead.
2. **Desktop dev workflow with Chrome DevTools mobile emulation.** Emulation genuinely reports `pointer: coarse` because it's emulating a touch device, so the scanner correctly dispatches to the live camera path. The escape hatch lets a developer pick a test image without leaving emulation mode.

---

## Device detection

`useIsMobile` in `apps/web/src/hooks/useIsMobile.ts` uses `window.matchMedia('(pointer: coarse)')` to detect touch-first devices. This is capability-based, not user-agent-based, and correctly handles:

- **Phones / Android tablets** → `pointer: coarse` → mobile ✓
- **iPads (even with Mac UA)** → `pointer: coarse` → mobile ✓
- **Desktop with mouse** → `pointer: fine` → desktop ✓
- **Touchscreen laptops (Surface, iPad Pro with trackpad)** → primary pointer is a mouse → `pointer: fine` → correctly treated as desktop ✓

The hook is SSR-safe: returns `false` during the server render and first client render, then updates via `useEffect` on mount. It also listens for `change` events on the `MediaQueryList` so it responds to runtime pointer-type changes (e.g., attaching a USB mouse to a tablet).

**Why not user-agent sniffing:** UA regexes are brand-based, fragile, and miss edge cases. iPadOS 13+ reports a Mac UA by default, so iPads would be misclassified. New devices or custom browser UAs can slip through any regex. matchMedia is the CSS spec's intended device classification API.

---

## Error taxonomy

`ScanErrorKind` in `apps/web/src/hooks/useBarcodeScan.tsx` is a discriminated union of failure modes:

- `no_barcode_in_image` — decoder ran, found nothing
- `pdf_unreadable` — PDF rasterization via unpdf failed
- `heic_conversion_failed` — `/api/convert-heic` returned non-2xx
- `file_too_large` — exceeds the 20 MB limit
- `result_handler_error` — the caller's `onResult` callback threw
- `decoder_error` — generic decoder failure (currently used for live scanner errors)

The `onError` callback signature is `(message: string, kind?: ScanErrorKind) => void`, so callers can branch on the kind if they want specific handling, or ignore it and just display the message. The `ERROR_MESSAGES` constant maps each kind to a user-facing default message.

---

## Label rendering

`apps/web/src/lib/barcode-render.ts` wraps bwip-js. `getBwipBcid(format)` maps a Kasero `BarcodeFormat` enum value to the corresponding bwip-js BCID string (e.g., `EAN_13` → `ean13`, `CODE_128` → `code128`, etc.).

`renderBarcodeSvg(value, format)` produces an SVG string that can be injected into the DOM or handed to a print dialog. It's used by:

- `BarcodeDisplay` for the live preview in product forms.
- `BarcodeFields.handlePrint` for the print-this-label flow.

### Print flow

`BarcodeFields.handlePrint` creates a hidden iframe, writes a minimal print document with the SVG and metadata, and calls `window.print()` on the iframe. The iframe is cleaned up on `afterprint`. This avoids triggering the main window's print dialog and lets the label print with its own styling.

---

## Display components

### BarcodeFields (full form)

Used in the product add/edit modal. Renders:

- A full-width barcode value input with an inline copy button.
- The `BarcodeDisplay` live preview in a fixed-height card (`h-44`) that doesn't jump as different formats render.
- A metadata line under the preview showing `${value} · ${formatLabel}` and a source label (Scanned / Generated / Manual).
- Three action buttons: Scan, Generate, Print.

**The format dropdown was removed.** Format is derived from the value via `detectBarcodeFormat` and passed to `BarcodeDisplay` automatically.

### BarcodeDisplay (visual only)

Renders the bwip-js SVG for a given `(value, format)` pair. Handles three states:

- Empty value → "Barcode visual appears here once you scan or generate a code" placeholder.
- Render error → shows the error message in a tertiary-colored text block.
- Success → renders the SVG with CSS constraints forcing it to fill the parent via `w-full overflow-x-auto flex justify-center`.

### AiBarcodeStep (minimal form)

A stripped-down version of `BarcodeFields` used in the AI snap-to-add flow. Only has Scan and Generate actions — no manual input field, no print button. Uses the same `useBarcodeScan` hook.

---

## Design tokens

All visible styling in barcode components goes through the design tokens defined in `apps/web/src/styles/base.css` and aliased in `apps/web/tailwind.config.js`:

- **Colors:** `text-text-inverse` for white text on dark backgrounds, `bg-error` / `var(--color-error)` for the danger-colored laser line, `text-text-primary` / `text-text-secondary` / `text-text-tertiary` for on-surface text in the form fields.
- **Spacing:** all `p-*`, `gap-*`, `mt-*`, `w-*`, `h-*` classes map to `var(--space-*)` via the Tailwind config.
- **Border radius:** `rounded-full`, `rounded-lg`, `rounded-2xl`, `rounded-tl-lg` (etc.) map to `var(--radius-*)`.
- **Font sizes:** `text-sm`, `text-xs`, `text-base` map to `var(--text-*)`.

**One deliberate exception:** the live scanner overlay uses hardcoded `bg-black` / `bg-black/60` / `bg-black/80` / `from-black/80` for its camera viewfinder backdrop. This is a camera-chrome context where dark UI is semantically correct regardless of the user's theme, matching iOS Camera, Apple Wallet, and Google Lens. Using theme-aware tokens would produce a jarring white overlay in light mode that obscures the camera feed.

---

## Auth cookie, HTTPS dev, hydration fixes

Adjacent changes that aren't strictly barcode-related but enable mobile scanner testing:

- **HTTPS dev server is required** for `getUserMedia` to grant camera permission — browsers only expose the camera API on HTTPS origins or `localhost`. The Vite dev server in `apps/web/` is configured to serve over HTTPS using the Tailscale dev certs at `apps/api/certificates/tailscale-dev.{key,crt}`. The Next.js API server in `apps/api/` does the same so the SPA's `/api/*` proxy target is also HTTPS.
- **`useSecureCookies: process.env.NODE_ENV === 'production'`** in `apps/api/src/lib/auth.ts`. In dev (non-secure) the cookie name is `kasero.session_token`; in prod it becomes `__Secure-kasero.session_token`. Chrome on Android refuses to persist cookies without the Secure flag on HTTPS origins with self-signed certificates — when developing on a real device against the Tailscale HTTPS cert, set `NODE_ENV=production`-style flags via `npm run start:local` so the secure variant is issued.
- **`sameSite: 'lax'`** instead of `'strict'` to avoid edge cases where strict caused cookies to be dropped on top-level navigations and PWA launcher taps.

---

## Known limitations and deferred work

The following issues are tracked but not addressed in the current code. They belong in a future "data recovery" sprint.

### Scanning deleted products

Products are hard-deleted. If a user deletes a product, the `KSR-` label remains on the physical item but scanning it returns no match because the row is gone from the database. This is expected behavior — the user would need to create a new product.

The source/prefix validator rejects `scanned + KSR-` combinations on the grounds that real retail labels never start with `KSR-`. This rule remains correct since KSR- codes are generated internally and there is no restore path.

### Multi-page PDF scanning

`rasterizePdfFirstPage` rasterizes only page 1 of PDFs. If the barcode is on page 2 or later, the scan returns "no barcode detected" with no hint to try another page. Acceptable for now — users can crop the PDF or use a different page.

### UPC-E expansion

UPC-E is a compressed form of UPC-A with 6 or 8 visible digits. The decoder returns the compressed form; the system stores it as-is without expanding to the 12-digit UPC-A. External systems that key on UPC-A wouldn't match. Fix is to add `expandUpcE(value)` and run it in the scanner result handler before storage.

### Cross-platform KSR- round-trip testing

The hardening work confirmed KSR- labels round-trip correctly via the in-app scanner on iPhone Safari. A fuller matrix (multiple scanner brands, print sizes, label degradation) hasn't been tested. Risk: if some scanner returns the `-` in `KSR-` as a space or drops it, exact-match lookups will silently fail. Mitigation would be normalizing dashes out of both the stored value and the scanner input, or changing the KSR generator to omit the dash.

---

## Quick reference — "where do I touch this?"

| Change | File(s) |
|---|---|
| Add a new barcode format to the cascade | `packages/shared/src/barcodes.ts` (cascade + bwip-js BCID map) |
| Change the KSR- label format | `packages/shared/src/barcodes.ts` (`generateInternalProductBarcode` + cascade's KSR check) |
| Adjust the normalization (trim/uppercase/etc.) | `packages/shared/src/barcodes.ts` (`normalizeBarcodeValue`) |
| Change duplicate detection logic | Both product API routes (`apps/api/src/app/api/businesses/[businessId]/products/`) |
| Change the live scanner UI | `apps/web/src/components/products/LiveBarcodeScanner.tsx` |
| Change the file-picker flow | `apps/web/src/hooks/useBarcodeScan.tsx` (`handleFile`) |
| Change device detection | `apps/web/src/hooks/useIsMobile.ts` |
| Add a new scanner error kind | `apps/web/src/hooks/useBarcodeScan.tsx` (`ScanErrorKind` + `ERROR_MESSAGES`) |
| Change the barcode form layout | `apps/web/src/components/products/BarcodeFields.tsx` |
| Change the render output | `apps/web/src/lib/barcode-render.ts` + bwip-js options |
