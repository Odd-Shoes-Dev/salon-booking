import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { sendCancellationSms } from '@/lib/sms';

// POST /api/bookings/[bookingNumber]/cancel
// Body: { guest_phone, reason? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingNumber: string }> }
) {
  try {
    const { bookingNumber } = await params;
    const body = await request.json();
    const { guest_phone, reason } = body;

    if (!guest_phone?.trim()) {
      return NextResponse.json({ error: 'Phone number required to verify identity.' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Verify ownership
    const [booking] = await sql`
      SELECT id, status, guest_name, guest_phone, booking_date, start_time
      FROM bookings
      WHERE salon_id      = ${salon.id}
        AND booking_number = ${bookingNumber.trim().toUpperCase()}
        AND guest_phone    = ${guest_phone.trim()}
    `;
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found or phone does not match.' }, { status: 404 });
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'This booking cannot be cancelled.' }, { status: 400 });
    }

    // Enforce cancellation window
    const [settings] = await sql`
      SELECT cancellation_hours FROM booking_settings WHERE salon_id = ${salon.id}
    `;
    const cancellationHours = settings?.cancellation_hours ?? 24;
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    const hoursUntil = (bookingDateTime.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil <= cancellationHours) {
      return NextResponse.json(
        { error: `Cancellations must be made at least ${cancellationHours} hours before the appointment. Please call us directly.` },
        { status: 400 }
      );
    }

    await sql`
      UPDATE bookings
      SET status = 'cancelled',
          cancelled_at = NOW(),
          cancellation_reason = ${reason?.trim() || 'Cancelled by customer'}
      WHERE id = ${booking.id}
    `;

    sendCancellationSms({
      customerPhone: booking.guest_phone,
      customerName: booking.guest_name,
      bookingNumber: bookingNumber.trim().toUpperCase(),
      salonName: salon.name,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('cancel error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
