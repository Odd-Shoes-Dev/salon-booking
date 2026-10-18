# salon-booking — Overview

Standalone Next.js 15 app for customer self-booking. Runs separately from the main salon management system and shares the same Neon PostgreSQL database. Booking itself never requires login — an optional phone-OTP **client portal** (see below) lets a returning customer see their booking history and vouchers, and lets a booking be reliably linked to the right client record instead of showing up as a stranger to staff.

**See also:** [domain-routing.md](./domain-routing.md) — URL convention, `NEXT_PUBLIC_ROOT_DOMAIN`, safety redirects, DNS setup.

---

## Architecture

```
salon-booking/        ← separate repo / Vercel project
  src/
    middleware.ts     ← domain/subdomain resolution (public, no auth)
    app/
      layout.tsx      ← server component: resolves salon, injects brand color
      page.tsx        ← redirects to /booking
      booking/
        page.tsx                              ← multi-step booking form (client)
        confirmation/[bookingNumber]/
          page.tsx                            ← receipt page (server)
          PrintButton.tsx                     ← print button (client island)
      bookings/
        check/
          page.tsx                            ← check / cancel / reschedule (client)
      account/                                ← client portal (phone-OTP login)
        login/page.tsx, LoginForm.tsx         ← phone + OTP form (client)
        page.tsx                              ← server: redirects to /account/login if not signed in
        AccountDashboard.tsx                  ← booking history + vouchers (client)
      calendar/                               ← public, unauthenticated read-only booking calendar
        page.tsx                              ← server: pre-fetches services/staff for filters
        CalendarView.tsx                      ← date range + service/staff filters (client)
      api/
        salon/info/route.ts                   ← GET salon + booking settings
        services/route.ts                     ← GET active services
        workers/available/route.ts            ← GET available workers for a date
        slots/available/route.ts              ← GET available time slots
        calendar/route.ts                     ← GET upcoming bookings, date/service/staff-filtered — no auth
        bookings/
          create/route.ts                     ← POST create booking (also resolves/links a client — see Client Portal)
          check/route.ts                      ← POST look up booking (2-factor)
          [bookingNumber]/cancel/route.ts     ← POST cancel
          [bookingNumber]/reschedule/route.ts ← POST reschedule
        auth/                                 ← client portal auth — no auth required to call
          request-otp/route.ts                ← POST send a 6-digit code by SMS
          verify-otp/route.ts                 ← POST verify code, create session (signup on first login)
          logout/route.ts                     ← POST clear session
        account/                              ← requires a client session (cookie)
          me/route.ts                         ← GET name, phone, loyalty_points
          bookings/route.ts                   ← GET this client's booking history
          vouchers/route.ts                   ← GET this client's vouchers (coupons linked to them)
    lib/
      db/index.ts     ← Neon client (tagged template literal = parameterized SQL)
      tenants.ts      ← getSalonBySubdomain / getSalonByDomain
      slots.ts        ← getAvailableSlots / generateBookingNumber
      auth.ts         ← client session cookie: getCurrentClient / createClientSession / destroyClientSession
      sms.ts          ← SMS notifications — routes by network, see SMS Notifications below
    types/index.ts
  neon/
    migrations/
      007_booking_number.sql  ← adds booking_number, public_token, cancelled_at, rescheduled_at

  # Note: some migrations affecting this shared DB are numbered in the
  # salon-system repo instead (e.g. 036_client_accounts.sql, which adds the
  # client_sessions/client_otp_requests tables this app's auth relies on) —
  # migration numbering is per-repo, but they all apply to the one database.
```

---

## Booking Number Format

```
{SUBDOMAIN_6CHARS}-{YYYYMMDD}-{SEQ_3DIGITS}
```

Examples: `POSH-20260515-001`, `BLUEOX-20260601-023`

Generated in `src/lib/slots.ts → generateBookingNumber()`.

---

## Two-Factor Booking Access (no OTP, no login)

Customers access their booking using:
1. **Booking ID** (booking_number)  — shown on confirmation page
2. **Phone Number** — the one used when booking

```sql
SELECT * FROM bookings
WHERE booking_number = $1
  AND guest_phone    = $2
  AND salon_id       = $3
```

---

## Client Portal (Phone-OTP Login)

Solves a specific problem: a returning client booking online wasn't recognized as an existing client, so staff saw them as a stranger every time. The fix is asymmetric by design — easy for new people, verified for existing ones — to balance zero-friction signup against someone typing (by mistake or on purpose) a phone number that isn't theirs.

**Logging in** (`/account/login`, `POST /api/auth/request-otp` then `POST /api/auth/verify-otp`):
1. Enter a phone number → a 6-digit code is SMS'd (10-minute expiry, bcrypt-hashed at rest, max 3 requests per phone per 10-minute window, max 5 verify attempts before the code is dead).
2. Enter the code. If the phone matches an existing client, a session is created immediately. If it's a brand-new phone number, the response is `{ requiresName: true }` — the client resubmits the **same** `{ phone, code, name }` to finish signup (the code isn't consumed by the first attempt, so this doesn't cost a second SMS).
3. A 60-day session cookie (`client_auth_token`, httpOnly) is set. `getCurrentClient()` in `src/lib/auth.ts` reads it on every request that needs to know who's logged in.

**Linking a booking to a client** (`POST /api/bookings/create`, see the comment block above `clientId` in that file) — three cases:
- **Logged in** → use that session's client, no further checks.
- **Phone matches an existing client, not logged in** → don't silently attach the booking to a stranger's profile. The API responds `{ requiresVerification: true }`; the booking form then offers to verify via OTP inline, with a **"continue as guest without verifying"** fallback that still creates the booking but leaves it unlinked (`client_id = null`).
- **Phone matches nobody** → nothing to impersonate, so a new client is created immediately from what was typed, zero friction. Any later booking with that same number is now "recognized" and goes through the verification branch above.

**The account dashboard** (`/account`, server-rendered, redirects to `/account/login` if no session) shows booking history and vouchers (coupons linked to `client_id`) for the logged-in client. `/api/account/me`, `/bookings`, `/vouchers` expose the same data for any client-side refresh.

---

## Minimum Advance Notice

Self-bookings require a minimum lead time before the appointment, configurable per salon via `booking_settings.min_advance_minutes` (defaults to 60 minutes if unset) — **not** a fixed 48 hours.

- The booking form's calendar (`BookingForm.tsx → getMinDate()`) only blocks genuinely past dates — same-day booking is allowed at the date-picker level.
- The actual cutoff is enforced where slots are generated, `getAvailableSlots()` in `src/lib/slots.ts`: on the current day, any slot starting less than `min_advance_minutes` from now (East-Africa-Time-aware) is simply never returned.
- `POST /api/bookings/create` re-checks the same `min_advance_minutes` server-side before creating the booking, so a stale slot list can't be submitted after time passes.
- Rescheduling calls the same `getAvailableSlots()` for the new slot, so it gets the same minimum-advance check for free. The *original* appointment is separately protected by `booking_settings.cancellation_hours` (defaults to 24h) — a reschedule request is rejected if it's too close to the existing appointment time, regardless of how far out the new one is.

---

## Auto-Confirm Logic

Currently all self-bookings start as `pending`. The main salon system staff confirm them.  
Slot conflict is prevented by a DB query before insert.

---

## Database Tables Used

| Table                   | Usage                                              |
|-------------------------|-----------------------------------------------------|
| `salons`                | Multi-tenancy, brand color, phone                  |
| `services`               | Service list                                       |
| `workers`                | Staff selection                                    |
| `staff_schedules`        | Working days per staff member                      |
| `bookings`                | Create / check / cancel / reschedule / public calendar |
| `booking_settings`       | Hours, buffer, cancellation window, min advance notice |
| `clients`                 | Matched/created when booking; client portal account |
| `client_sessions`        | Client portal login sessions (60-day cookie token) |
| `client_otp_requests`    | Hashed OTP codes for client portal login            |
| `coupons`                 | Vouchers — shown on the account dashboard when linked to a `client_id` |

> `client_sessions` / `client_otp_requests` / `coupons.client_id` were added by `036_client_accounts.sql` in the **salon-system** repo (shared DB — see note above the architecture tree).

---

## Public Calendar Page

`/calendar` — a read-only view of upcoming bookings, deliberately **not linked from any nav** (reachable only by direct URL, e.g. for staff checking their schedule from a phone) and `noindex`/`nofollow` so search engines don't pick it up. No login, since it lives on the public booking site rather than the staff system.

- Defaults to today → +7 days, no hard date cap — filterable by date range, service, and staff (`GET /api/calendar`, also no auth).
- Returns only `booking_date`, `start_time`, `end_time`, `service_name`, `staff_name` — **never** client name, phone, notes, or booking number, so there's nothing sensitive to leak on an unauthenticated route.
- Only `pending`/`confirmed` bookings that haven't started yet (East-Africa-Time-aware "now" check, same approach as [Minimum Advance Notice](#minimum-advance-notice) above), capped at 500 rows.

---

## Environment Variables

```
DATABASE_URL              # Neon PostgreSQL connection string
NEXT_PUBLIC_APP_URL       # Public URL of this booking app (for SMS links)

# SMS — see "SMS Notifications" below for routing logic
SMS_PROVIDER               # 'esms' (default) or 'africastalking' — which provider non-MTN numbers use
ESMS_API_KEY               # eSMS Africa API key (optional — SMS skipped if unset)
ESMS_BASE_URL               # https://sms.esmsafrica.io
AT_API_KEY / AT_USERNAME / AT_SENDER_ID  # Africa's Talking credentials (optional, used when SMS_PROVIDER=africastalking)
SMSUG_API_KEY               # sms.ug API key — the only provider here that can reach MTN numbers (optional — MTN SMS skipped if unset)

SYSTEM_ORIGIN              # URL of main salon management system (for CORS if needed)
```

---

## Running Locally

```bash
cp .env.local.example .env.local
# fill in DATABASE_URL (same Neon DB as main system)
npm install
npm run dev   # starts on port 3002
```

Main system must run on port 3001 simultaneously if testing together.

---

## Deployment

Deploy as a separate Vercel project pointing to the same Neon database.  
Set the same environment variables.  
Custom domain can be added in Vercel project settings.

---

## SMS Notifications

Events (all non-blocking — the triggering action succeeds even if SMS fails):

| Event                          | Recipient    |
|---------------------------------|--------------|
| Booking created                | Customer     |
| Booking created                | Salon owner  |
| Booking confirmed by staff      | Customer     |
| Booking cancelled               | Customer     |
| Client portal login code        | Customer     |

**Routing (`src/lib/sms.ts → sendSms()`):** MTN numbers (Uganda prefixes 076/077/078/079) always go through **sms.ug** — the only one of these providers confirmed to actually reach MTN. Everything else uses whichever provider `SMS_PROVIDER` selects (`esms`, the default, or `africastalking`). If a provider's credentials aren't set in the environment, sends through it are skipped silently rather than breaking the booking flow — same as before, just now per-provider instead of all-or-nothing.

> **sms.ug content filter:** confirmed by live testing against their API — it rejects any message containing the literal words "code", "OTP", or "passcode" (a keyword match, not a semantic OTP detector). This is why the login SMS (`sendOtpSms`) says "login PIN" instead of "login code"/"OTP".
