// Temporary toggles for built, working features that aren't earning their
// keep right now — nothing behind these is removed, just not shown/enforced.
// Flip back to true the moment there's real demand for either.

// The "Log In" / "My Account" link on the booking page, and by extension the
// whole client portal (booking history, loyalty points). Built for a future
// need that hasn't materialized yet.
export const CLIENT_PORTAL_VISIBLE = false;

// Whether booking with a phone number that already matches a registered
// client requires OTP verification (or an explicit "continue as guest")
// before the booking is created. Exists to stop a booking from being
// silently linked to the wrong person's client record. Currently unneeded
// because the salon reconciles which client a booking belongs to at
// payment time anyway, so the extra step is pure friction for now.
export const REQUIRE_PHONE_VERIFICATION = false;
