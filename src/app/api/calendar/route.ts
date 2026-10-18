import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// GET /api/calendar — no auth required
// Returns upcoming (never past) pending/confirmed bookings: date, time,
// service, and staff only — deliberately never client name/phone/notes/
// booking_number, so there's nothing sensitive to leak on this public route.
// Query params: from, to (YYYY-MM-DD, both optional), service_id, staff_id.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from      = searchParams.get('from');
    const to        = searchParams.get('to');
    const serviceId = searchParams.get('service_id');
    const staffId   = searchParams.get('staff_id');

    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json({ error: 'Invalid from date format.' }, { status: 400 });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'Invalid to date format.' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // "Now" in East Africa Time regardless of server timezone — same approach
    // used throughout lib/slots.ts and bookings/create/route.ts.
    const now = new Date();
    const localNow  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
    const today     = localNow.toISOString().split('T')[0];
    const currentTime = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;

    const bookings = await sql`
      SELECT
        b.booking_date::text AS booking_date,
        b.start_time::text   AS start_time,
        b.end_time::text     AS end_time,
        s.name AS service_name,
        w.name AS staff_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN workers  w ON w.id = b.staff_id
      WHERE b.salon_id = ${salon.id}
        AND b.status IN ('pending', 'confirmed')
        AND (b.booking_date > ${today}::date OR (b.booking_date = ${today}::date AND b.start_time >= ${currentTime}::time))
        AND (${from}::date IS NULL OR b.booking_date >= ${from}::date)
        AND (${to}::date   IS NULL OR b.booking_date <= ${to}::date)
        AND (${serviceId}::uuid IS NULL OR b.service_id = ${serviceId}::uuid)
        AND (${staffId}::uuid   IS NULL OR b.staff_id   = ${staffId}::uuid)
      ORDER BY b.booking_date ASC, b.start_time ASC
      LIMIT 500
    `;

    return NextResponse.json(bookings);
  } catch (err) {
    console.error('calendar GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
