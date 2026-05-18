# Sign in with Apple — Operator Setup Guide

A step-by-step reference for the human work needed to bring the
already-shipped Kasero Sign in with Apple integration online. The code
side is done (commit range `589c244d..9efa9b5a` on `main`); this doc
covers everything you do **outside** the codebase: enrolling in Apple
Developer Program, configuring identifiers and keys in Apple's portal,
and pasting credentials into Vercel.

Last verified against Apple's docs: **May 2026**. If the portal UI has
shifted by the time you do this, the field names below should still be
recognizable — Apple changes labels rarely.

---

## TL;DR (5-minute version)

1. Enroll in Apple Developer Program — `developer.apple.com/programs/enroll` ($99/yr, ~24-48h).
2. Create an **App ID** with Sign in with Apple capability. Bundle ID = `app.kasero.ios` (placeholder for the future native app).
3. Create a **Services ID** linked to that App ID. Identifier = `app.kasero.web`. Add `kasero.app` (domain) and `https://kasero.app/api/auth/callback/apple` (return URL) to its Website URLs (comma-delimited).
4. Create a **Sign in with Apple Key**. Download the `.p8` once. Note the **Key ID**.
5. Note your **Team ID** from the top-right of the developer portal.
6. In Vercel project settings, set these env vars on **Production only**:
   - `APPLE_CLIENT_ID` = `app.kasero.web`
   - `APPLE_TEAM_ID` = (10-character team ID)
   - `APPLE_KEY_ID` = (10-character key ID from step 4)
   - `APPLE_PRIVATE_KEY` = entire contents of the `.p8` file, headers and newlines included
7. Trigger a redeploy (push or "Redeploy" button).
8. Test the flow on `https://kasero.app` per the Smoke Test section below.

That's it. The backend already mints the JWT clientSecret in-process from those four env vars on every cold start, so there is no human rotation to schedule.

---

## 1. Enroll in Apple Developer Program

**URL:** `https://developer.apple.com/programs/enroll`

**Prerequisites:**
- An Apple ID with **two-factor authentication enabled** (mandatory for individual enrollment as of 2026).
- A valid government-issued ID (Apple may ask for verification).
- Be the legal age of majority in your region.
- Credit/debit card for the $99 USD annual fee. Apple bills annually as an auto-renewable subscription if you enroll via the iOS Apple Developer app, or one-time per year if you enroll on the web (you choose at checkout).

**Choosing entity type:**
- **Individual**: simplest, your name appears as the seller on the App Store. Recommended for Kasero given its current scale.
- **Organization**: needs a [D-U-N-S Number](https://www.dnb.com/duns-number/get-a-duns.html) (free; takes ~5 days to get if you don't already have one). Allows team members and shows your company name as the seller.

**Timeline:** Apple says hours to 48 hours. In practice it's usually under a day if your payment goes through cleanly and there are no name-mismatch issues with your Apple ID.

**Fee waivers:** Available for nonprofits, accredited educational institutions, and government entities. Not relevant to Kasero.

You'll know enrollment is complete when you can sign in to `developer.apple.com/account` and see "Certificates, IDs & Profiles" in the sidebar (rather than just the public docs).

---

## 2. Create the App ID

The App ID represents the future native iOS app. We create it now even though no iOS app ships yet, because the Services ID (step 3) must be linked to a primary App ID with Sign in with Apple capability enabled. Setting it up now means zero portal work when the native app does ship.

**Where:** `developer.apple.com/account` → **Certificates, IDs & Profiles** → **Identifiers** (sidebar).

**Steps:**

1. Click the **`+`** button (top left).
2. Select **App IDs** → **Continue**.
3. Select type **App** → **Continue**.
4. Fill in:
   - **Description**: `Kasero iOS App` (free-text, for your reference only).
   - **Bundle ID**: select **Explicit** and enter `app.kasero.ios` (or your preferred reverse-DNS string). This is the iOS app's eventual Bundle ID — pick it carefully because changing it later is painful.
5. Scroll to **Capabilities**. Find **Sign in with Apple** and check the box. (You can leave the Edit / Configure modal alone — defaults are fine for the most common single-app case.)
6. Click **Continue** → review → **Register**.

The App ID now exists. You can leave it forever — even when the iOS app ships years later, the same App ID continues to work.

---

## 3. Create the Services ID (this is the credential the WEB uses)

The Services ID is the actual `clientId` your web backend sends to Apple during OAuth. It's separate from the App ID.

**Where:** `developer.apple.com/account` → **Certificates, IDs & Profiles** → **Identifiers**.

**Steps:**

1. Click the **`+`** button.
2. Select **Services IDs** → **Continue**.
3. Fill in:
   - **Description**: `Kasero Web` (free-text).
   - **Identifier**: `app.kasero.web` — this is what goes into `APPLE_CLIENT_ID`. It must be different from the App ID's Bundle ID.
4. Click **Continue** → review → **Register**. The Services ID now exists but isn't yet enabled for Sign in with Apple.
5. Click the Services ID you just created in the list to open it. Check the **Sign in with Apple** box, then click the **Configure** button that appears next to it.
6. In the configuration modal:
   - **Primary App ID**: select the App ID you created in step 2 (`app.kasero.ios`).
   - **Website URLs** field: this accepts a single **comma-delimited list** of your website's domains and the OAuth return URL together. Enter:
     ```
     kasero.app, https://kasero.app/api/auth/callback/apple
     ```
     (One domain plus one return URL, separated by a comma. The domain has no protocol; the return URL is fully qualified with `https://`.)
7. Click **Save** → **Continue** → **Save** again on the outer screen.

**No `apple-developer-domain-association.txt` file is required for Sign in with Apple in 2026.** (This file was historically needed for some Apple services; older guides on the internet still mention it. For the Sign in with Apple Services ID flow specifically, Apple has confirmed no file upload is required.) Apple Pay still requires it — that's a different flow we don't use.

**URL limits:** Individual enrollment caps at 10 total Website URLs per Services ID; Organization at 100. We're using 2 of those slots (one domain, one return URL). Plenty of room for future preview/staging environments if you ever want them.

**If you need to add a preview/staging URL later:** open the Services ID → Sign in with Apple → Configure → add the new URL to the comma-delimited list → Save.

---

## 4. Create the Sign in with Apple Key

This is the `.p8` private key whose contents become `APPLE_PRIVATE_KEY` in Vercel.

**Where:** `developer.apple.com/account` → **Certificates, IDs & Profiles** → **Keys** (sidebar).

**Steps:**

1. Click the **`+`** button.
2. Fill in:
   - **Key Name**: `Kasero Sign in with Apple` (free-text).
3. Check the **Sign in with Apple** box. Apple will show a **Configure** button next to it.
4. Click **Configure**. In the modal:
   - **Primary App ID**: select the App ID from step 2 (`app.kasero.ios`).
   - Click **Save**.
5. Back on the key creation screen, click **Continue** → review → **Register**.
6. Apple will now show a **Download** button. **Click it.**

   > **CRITICAL — one-time download.** Apple will not let you re-download this key. If you lose it, you have to revoke the key and create a new one (which means generating a new `APPLE_KEY_ID` and updating Vercel).

7. The downloaded file is named something like `AuthKey_ABCD1234XY.p8`. The `ABCD1234XY` portion (10 alphanumeric chars between `AuthKey_` and `.p8`) is your **Key ID** — note it now. You can also see the Key ID by opening the key in the portal later.

8. Click **Done**.

**Storage:** Save the `.p8` somewhere durable and private (a password manager's secure-note feature works well; or your laptop's encrypted disk; or a private GitHub gist on a private account — but never commit it to any repo). You'll need its contents for Vercel in step 6, and again whenever you want to verify or reconfigure.

**Limit:** Apple lets you associate **up to 2 active Sign in with Apple keys per primary App ID** (per `developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key`). This is NOT an account-wide cap: if you ever add a second project with its own primary App ID, that App ID gets its own pair of slots. Other key capabilities (APNs, WeatherKit, DeviceCheck, etc.) have separate quotas — your SIWA key allocation is not consumed by those. If you ever revoke a key, you can create a replacement immediately in the same slot.

---

## 5. Note your Team ID

**Where:** `developer.apple.com/account` → top-right of any page in the developer portal, or **Membership Details** in the sidebar.

It's a 10-character alphanumeric string (e.g., `7K9LMN3PQR`). Copy it — this becomes `APPLE_TEAM_ID`.

---

## 6. Set the env vars in Vercel (Production only)

**Where:** Vercel dashboard → your project → **Settings** → **Environment Variables**.

Add **four** variables. For each, the **Environment** must be set to **Production only** — uncheck Preview and Development. Apple's Services ID is registered with the production callback URL only; preview/dev callbacks would fail at Apple's side anyway.

| Name | Value | Notes |
|---|---|---|
| `APPLE_CLIENT_ID` | `app.kasero.web` | The Services ID identifier from step 3 |
| `APPLE_TEAM_ID` | (10-char from step 5) | Your team ID |
| `APPLE_KEY_ID` | (10-char from step 4) | The key ID from the `.p8` filename |
| `APPLE_PRIVATE_KEY` | (paste the entire `.p8` file contents — see below) | Multi-line, includes BEGIN/END markers |

**About `APPLE_PRIVATE_KEY`:**

Open the `.p8` file in any text editor. You'll see something like:

```
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg...
...about 4-5 lines of base64...
-----END PRIVATE KEY-----
```

Paste **the entire content** into Vercel's value field — including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines and the newlines between them. Vercel preserves multi-line values when pasted via the dashboard. **Don't** wrap it in quotes; **don't** replace newlines with `\n` escapes; **don't** strip the BEGIN/END headers.

If the key is mangled (e.g. newlines lost), the API will fail to boot at the next deploy with a clear error in the Function logs (`importPKCS8` throws). Loud failure, easy to fix — just re-paste.

---

## 7. Trigger a redeploy

Two ways:

- **Push something** to `main`. Even a no-op commit works (`git commit --allow-empty -m "chore: trigger redeploy"` then `git push`). Vercel auto-deploys from `main`.
- **Click Redeploy** on the most recent production deployment in the Vercel dashboard. Make sure to **uncheck** "Use existing Build Cache" — you want the env vars re-injected.

Watch the deploy logs. The build itself doesn't touch Apple at all (env vars are only read at runtime). If the build succeeds and the function cold-starts cleanly, you're live.

To confirm the Apple block is wired up, hit any API route once (e.g. visit `https://kasero.app` in a browser; the SPA shell triggers a session-cookie check via `/api/auth/get-session`). If the function returns successfully, `auth.ts` evaluated successfully, which means the JWT minted successfully.

If you see a 500 from any auth route after deploy, check the function logs in Vercel → Logs. The most likely culprit is a malformed `APPLE_PRIVATE_KEY` (e.g. newlines lost, or the BEGIN header dropped during paste).

---

## 8. Smoke test

Open `https://kasero.app` in a fresh incognito window (so there's no existing session).

### A. First-time Apple sign-in (real email)

1. Click **Continue with Apple**.
2. You'll be redirected to `appleid.apple.com`.
3. Sign in with an Apple ID that has **never** authorized Kasero before. (Use a test/secondary Apple ID — your main one will work, but then you can't repeat this step.)
4. On Apple's "Use your Apple ID for…" screen, choose **Share My Email** (we'll test the relay path separately).
5. Apple bounces back to `https://kasero.app/api/auth/callback/apple`, which redirects to `/`. You should land on the hub, signed in.

**Verify in the database (Turso Studio or `db:studio:prod`):**
- A new row exists in `users` with the email Apple shared.
- `users.name` is populated with the name from Apple. **This is the most fragile thing to verify.** Apple sends `name` only on the very first authorization for that user. If `users.name` is empty, the front-end never received it on the round-trip — file it as a bug.
- `users.emailVerified` is `1`.
- A new row exists in `account` with `providerId = 'apple'`, `userId` matching the user above, and an `accountId` matching Apple's `sub` claim.

### B. Account linking — email-OTP user signs in with Apple

1. Sign out.
2. Sign up via the **email-OTP** flow using the same email Apple shared in step A.
3. Sign out.
4. Sign in with Apple again using the same Apple ID.

Expected: same `users` row from step A is reused. The `account` table now has **two** rows for that user — one `providerId='credential'` (email OTP) and one `providerId='apple'`. This proves `'apple'` in `trustedProviders` is doing its job. If you end up with two `users` rows, account linking didn't fire — dig into the `account.accountLinking` config.

### C. Account linking — Google user signs in with Apple

(Optional but worth doing once.)

1. Sign in via Google with an account whose email also exists on Apple.
2. Sign out.
3. Sign in with Apple using the same Apple ID/email.

Expected: same `users` row, two `account` rows (`providerId='google'` and `providerId='apple'`).

### D. Hide My Email (private relay)

1. Sign out.
2. Sign in with Apple using a **different** Apple ID. On the consent screen, choose **Hide My Email**.
3. Land on the hub.

Verify:
- `users.email` is `xxxxxx@privaterelay.appleid.com` (an opaque relay address).
- Outgoing emails to that address get forwarded to the user's real inbox by Apple. Test by triggering an outgoing email (e.g. start a destructive-action OTP step-up flow). The OTP should arrive in your real inbox.

### E. Misconfigured-button check (cosmetic)

In a non-production environment (preview deploy, or your local dev with API on `localhost:8000`), click "Continue with Apple". Expected: the click triggers a redirect to Apple, which then errors out because the local/preview URL isn't whitelisted in the Services ID. The button should re-enable on the way back. The user-visible UX in this edge case is "click → spinner → return to login screen with no message" — not great, but acceptable for a pre-launch project. If you want to surface a clearer error, that's a future polish task; not blocking.

---

## 9. App Store policy notes (for when you ship the iOS app later)

App Store Review Guideline 4.8 used to require Sign in with Apple if you offered any other social login. **As of January 2024**, this has been relaxed: you can offer any login service that meets these properties:
- Limits data collection to the user's name and email
- Allows users to keep their email private
- Does not track users

Google Sign-In meets the first and third; the second is debatable. **In practice, having Sign in with Apple on the web (which this project now does) future-proofs the iOS app against any reviewer interpretation of 4.8.** When you eventually wrap Kasero in a Capacitor iOS app, the SIWA infrastructure is already there — just needs the iOS-side plugin and the `APPLE_APP_BUNDLE_IDENTIFIER` env var to point at the iOS Bundle ID.

---

## Cheat sheet

When something breaks, check these in order:

1. **API returning 500 on any route after deploy?** → `APPLE_PRIVATE_KEY` is malformed. Re-paste the `.p8` contents into Vercel.
2. **Apple shows "invalid_request" or "redirect_uri" error on its OAuth page?** → The URL the browser was sent to doesn't match what's registered in the Services ID. Compare what's in the address bar at the failure to the Website URLs entry in the Apple portal.
3. **Apple flow completes but you land on `/login` instead of `/`?** → Better-auth couldn't process the callback. Look at the function logs for the response from `/api/auth/callback/apple`. Often a clientSecret/JWT issue (in which case re-mint by triggering a redeploy — cold start regenerates).
4. **Sign in works but `users.name` is empty?** → Apple only sends name on first-ever auth. If the first attempt failed at our side after Apple's side succeeded, the name is permanently lost for that Apple ID. Recovery: ask the user to revoke Kasero from `appleid.apple.com → Sign In with Apple → Apps Using Apple ID`, then sign in again. The next sign-in is treated as first-ever.
5. **Account linking didn't fire (two `users` rows for the same email)?** → Verify `'apple'` is in `account.accountLinking.trustedProviders` in the deployed code (it should be — Task 2 wired this).

---

## Sources used to write this guide (May 2026)

- Apple Developer — Configure Sign in with Apple for the Web: `https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/`
- Apple Developer — Register a Services ID: `https://developer.apple.com/help/account/identifiers/register-a-services-id/`
- Apple Developer — Create a private key: `https://developer.apple.com/help/account/keys/create-a-private-key/`
- Apple Developer Program — Membership details and enrollment: `https://developer.apple.com/programs/enroll/`
- App Store Review Guideline 4.8 (relaxed Jan 2024): `https://9to5mac.com/2024/01/27/sign-in-with-apple-rules-app-store/`
- Apple Developer News — Korea-specific 2026 update (NOT applicable to US-based developers): `https://developer.apple.com/news/?id=j9zukcr6`
