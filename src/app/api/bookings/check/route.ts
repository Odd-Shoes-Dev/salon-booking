import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// POST /api/bookings/check  — two-factor: booking_number + guest_phone
// Body: { booking_number, guest_phone }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { booking_number, guest_phone } = body;

    if (!booking_number?.trim() || !guest_phone?.trim()) {
      return NextResponse.json({ error: 'Booking ID and phone number are required.' }, { status: 400 });
    }
    if (booking_number.length > 50 || guest_phone.length > 30) {
      return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    const [booking] = await sql`
      SELECT
        b.id, b.booking_number, b.status,
        b.guest_name, b.guest_phone,
        b.booking_date::text, b.start_time::text, b.end_time::text,
        b.notes, b.cancellation_reason, b.created_at, b.cancelled_at, b.rescheduled_at,
        s.name  AS service_name, s.price AS service_price, s.duration_minutes,
        w.name  AS staff_name
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN workers  w ON w.id = b.staff_id
      WHERE b.salon_id      = ${salon.id}
        AND b.booking_number = ${booking_number.trim().toUpperCase()}
        AND b.guest_phone    = ${guest_phone.trim()}
      LIMIT 1
    `;

    if (!booking) {
      return NextResponse.json({ error: 'No booking found. Check your Booking ID and the phone number you used.' }, { status: 404 });
    }

    // Check if within cancellation window
    const [settings] = await sql`
      SELECT cancellation_hours FROM booking_settings WHERE salon_id = ${salon.id}
    `;
    const cancellationHours = settings?.cancellation_hours ?? 24;
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    const hoursUntil = (bookingDateTime.getTime() - Date.now()) / 3_600_000;
    const canCancel = ['pending', 'confirmed'].includes(booking.status) && hoursUntil > cancellationHours;
    const canReschedule = canCancel;

    return NextResponse.json({ booking, canCancel, canReschedule });
  } catch (err) {
    console.error('bookings/check error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
