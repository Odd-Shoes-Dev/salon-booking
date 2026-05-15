# salon-booking — Overview

Standalone Next.js 15 app for customer self-booking. Runs separately from the main salon management system and shares the same Neon PostgreSQL database. No customer login required.

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
      api/
        salon/info/route.ts                   ← GET salon + booking settings
        services/route.ts                     ← GET active services
        workers/available/route.ts            ← GET available workers for a date
        slots/available/route.ts              ← GET available time slots
        bookings/
          create/route.ts                     ← POST create booking
          check/route.ts                      ← POST look up booking (2-factor)
          [bookingNumber]/cancel/route.ts     ← POST cancel
          [bookingNumber]/reschedule/route.ts ← POST reschedule
    lib/
      db/index.ts     ← Neon client (tagged template literal = parameterized SQL)
      tenants.ts      ← getSalonBySubdomain / getSalonByDomain
      slots.ts        ← getAvailableSlots / generateBookingNumber
      sms.ts          ← SMS notifications via eSMS Africa (optional)
    types/index.ts
  neon/
    migrations/
      007_booking_number.sql  ← adds booking_number, public_token, cancelled_at, rescheduled_at
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

## 48-Hour Minimum Advance Rule

Self-bookings are only allowed for dates at least 48 hours from now.

- Enforced in the booking form (date picker `min` attribute)
- Enforced in `POST /api/slots/available`
- Enforced in `POST /api/bookings/create`
- Rescheduled date must also be 48h+ from now

---

## Auto-Confirm Logic

Currently all self-bookings start as `pending`. The main salon system staff confirm them.  
Slot conflict is prevented by a DB query before insert.

---

## Database Tables Used

| Table              | Usage                               |
|--------------------|-------------------------------------|
| `salons`           | Multi-tenancy, brand color, phone   |
| `services`         | Service list                        |
| `workers`          | Staff selection                     |
| `staff_schedules`  | Working days per staff member       |
| `bookings`         | Create / check / cancel / reschedule|
| `booking_settings` | Hours, buffer, cancellation window  |

---

## Environment Variables

```
DATABASE_URL              # Neon PostgreSQL connection string
NEXT_PUBLIC_APP_URL       # Public URL of this booking app (for SMS links)
ESMS_API_KEY              # eSMS Africa API key (optional — SMS skipped if unset)
ESMS_BASE_URL             # https://sms.esmsafrica.io
SYSTEM_ORIGIN             # URL of main salon management system (for CORS if needed)
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

Three SMS events (all non-blocking — booking succeeds even if SMS fails):

| Event             | Recipient       |
|-------------------|-----------------|
| Booking created   | Customer        |
| Booking created   | Salon owner     |
| Booking cancelled | Customer        |

SMS is sent via `src/lib/sms.ts` using the eSMS Africa API.  
If `ESMS_API_KEY` is not set, all SMS calls are silently skipped.
