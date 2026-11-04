# Known Issues / Tech Debt

Things we know about but have deliberately deferred. Not urgent enough to stop and fix the moment they're found, but real enough to track instead of forgetting.

---

## 1. No rate limiting on booking lookup / cancel / reschedule

**Where:** `POST /api/bookings/check`, `POST /api/bookings/[bookingNumber]/cancel`, `POST /api/bookings/[bookingNumber]/reschedule`.

**The risk:** these routes are the entire auth model for "manage my booking" (see [overview.md → Two-Factor Booking Access](./overview.md#two-factor-booking-access-no-otp-no-login)) — a plain `WHERE booking_number = $1 AND guest_phone = $2` lookup, no session, no OTP. There is **no rate limiting, attempt cap, or lockout** on any of them. Compare with `bookings/create`, which does have a simple cap (`src/app/api/bookings/create/route.ts` — max 3 pending/confirmed bookings per phone per salon per day) and with the client-portal OTP flow, which caps both requests and verify attempts (see [overview.md → Client Portal](./overview.md#client-portal-phone-otp-login)).

Booking numbers are not secret/random — they're predictable (`{SUBDOMAIN}-{YYYYMMDD}-{SEQ_3DIGITS}`, sequential within a day). That means:
- Someone with a phone number (their own, or one they're targeting) could iterate the 3-digit sequence for a given date to find a matching booking.
- Someone with a booking number (e.g. from a downloaded/shared confirmation image — see the phone-masking note in the confirmation page) could iterate short phone-number suffixes, especially if they already know the area code/prefix.

Neither requires anything more than scripting repeated POSTs — there's nothing here that currently slows that down.

**Direction for a real fix (not yet built):** pick one of:
1. A simple IP-based or phone-based rate limit on `check` (and by extension `cancel`/`reschedule`, which are only reachable after a successful `check` in the UI flow, but are independently callable as raw API routes) — mirror the pattern already used for `bookings/create`'s per-window cap.
2. An attempt-lockout after N failed lookups for a given booking_number or IP within a window, similar in spirit to the OTP verify-attempt cap.
3. At minimum, logging/alerting on repeated failed lookups so abuse is visible even before it's blocked.

---

## 2. Neon date/time columns come back as JS `Date` objects — recurring bug

Shared issue with the main `salon-system` repo — full writeup lives in [`salon-system/docs/known-issues.md`](../../salon-system/docs/known-issues.md#1-neon-datetime-columns-come-back-as-js-date-objects--recurring-bug). Short version: Postgres `date`/`time`/`timestamptz` columns come back as JS `Date` objects unless the query casts with `::text`, and code that treats the value as a string breaks (crash or silent "Invalid Date"). Already hit in this repo's reschedule/cancel routes (`booking_date`/`start_time` — `TypeError: bookingDate.split is not a function`), fixed at each call site individually so far but not with a systemic fix.
