import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { getAvailableSlots } from '@/lib/slots';

// POST /api/bookings/[bookingNumber]/reschedule
// Body: { guest_phone, new_date, new_start_time, new_end_time }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingNumber: string }> }
) {
  try {
    const { bookingNumber } = await params;
    const body = await request.json();
    const { guest_phone, new_date, new_start_time, new_end_time } = body;

    if (!guest_phone?.trim() || !new_date || !new_start_time || !new_end_time) {
      return NextResponse.json({ error: 'All fields required.' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(new_date)) {
      return NextResponse.json({ error: 'Invalid date format.' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Verify ownership
    const [booking] = await sql`
      SELECT id, status, guest_name, guest_phone,
             booking_date, start_time, end_time,
             staff_id, service_id
      FROM bookings
      WHERE salon_id      = ${salon.id}
        AND booking_number = ${bookingNumber.trim().toUpperCase()}
        AND guest_phone    = ${guest_phone.trim()}
    `;
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found or phone does not match.' }, { status: 404 });
    }
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'This booking cannot be rescheduled.' }, { status: 400 });
    }

    // Enforce cancellation window on original date
    const [settings] = await sql`
      SELECT cancellation_hours FROM booking_settings WHERE salon_id = ${salon.id}
    `;
    const cancellationHours = settings?.cancellation_hours ?? 24;
    const originalDateTime = new Date(`${booking.booking_date}T${booking.start_time}`);
    const hoursUntil = (originalDateTime.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil <= cancellationHours) {
      return NextResponse.json(
        { error: `Reschedules must be made at least ${cancellationHours} hours before the appointment.` },
        { status: 400 }
      );
    }

    // 48-hour minimum on new date
    const minDate = new Date();
    minDate.setMinutes(minDate.getMinutes() + 2880);
    if (new Date(new_date) < new Date(minDate.toISOString().slice(0, 10))) {
      return NextResponse.json(
        { error: 'New date must be at least 48 hours from now.' },
        { status: 400 }
      );
    }

    // Check the new slot is free
    const [service] = await sql`SELECT duration_minutes FROM services WHERE id = ${booking.service_id}`;
    const slots = await getAvailableSlots(
      salon.id, new_date, service?.duration_minutes ?? 60, booking.staff_id
    );
    const slotExists = slots.some(
      s => s.startTime === new_start_time.slice(0, 5) && s.endTime === new_end_time.slice(0, 5)
    );
    if (!slotExists) {
      return NextResponse.json({ error: 'That time slot is no longer available.' }, { status: 409 });
    }

    await sql`
      UPDATE bookings
      SET booking_date   = ${new_date},
          start_time     = ${new_start_time},
          end_time       = ${new_end_time},
          status         = 'pending',
          rescheduled_at = NOW()
      WHERE id = ${booking.id}
    `;

    return NextResponse.json({ success: true, newDate: new_date, newStartTime: new_start_time });
  } catch (err) {
    console.error('reschedule error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
