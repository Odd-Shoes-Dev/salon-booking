import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { generateBookingNumber } from '@/lib/slots';
import { sendBookingConfirmationSms, sendNewBookingAlertSms } from '@/lib/sms';

// POST /api/bookings/create  — no auth required
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      guest_name,
      guest_phone,
      service_id,
      staff_id,
      booking_date,
      start_time,
      end_time,
      notes,
    } = body;

    // Input validation (staff_id is optional — null means "any staff", assigned below)
    if (!guest_name?.trim() || !guest_phone?.trim() || !service_id || !booking_date || !start_time || !end_time) {
      return NextResponse.json({ error: 'All required fields must be provided.' }, { status: 400 });
    }
    if (guest_name.length > 100 || guest_phone.length > 30) {
      return NextResponse.json({ error: 'Invalid input length.' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return NextResponse.json({ error: 'Invalid date format.' }, { status: 400 });
    }

    // 48-hour minimum check
    const minDate = new Date();
    minDate.setMinutes(minDate.getMinutes() + 2880);
    if (new Date(booking_date) < new Date(minDate.toISOString().slice(0, 10))) {
      return NextResponse.json(
        { error: 'Bookings require at least 48 hours notice. For sooner appointments please call us directly.' },
        { status: 400 }
      );
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Verify service belongs to this salon
    const [service] = await sql`
      SELECT id, name, price, duration_minutes FROM services
      WHERE id = ${service_id} AND salon_id = ${salon.id} AND is_active = true
    `;
    if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });

    // Verify staff belongs to this salon — or auto-assign one if "Any Staff" selected
    let worker: { id: string; name: string; branch_id: string | null } | null = null;
    if (staff_id) {
      const [found] = await sql`
        SELECT id, name, branch_id FROM workers
        WHERE id = ${staff_id} AND salon_id = ${salon.id} AND is_active = true
      `;
      if (!found) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
      worker = found as { id: string; name: string; branch_id: string | null };
    } else {
      // Pick any active worker who is free at this time
      const [found] = await sql`
        SELECT id, name, branch_id FROM workers
        WHERE salon_id = ${salon.id} AND is_active = true
          AND id NOT IN (
            SELECT staff_id FROM bookings
            WHERE salon_id    = ${salon.id}
              AND booking_date = ${booking_date}
              AND status IN ('pending', 'confirmed')
              AND start_time < ${end_time}
              AND end_time   > ${start_time}
          )
        ORDER BY name
        LIMIT 1
      `;
      if (!found) return NextResponse.json({ error: 'No staff available at that time. Please try a different slot.' }, { status: 409 });
      worker = found as { id: string; name: string; branch_id: string | null };
    }
    const assignedStaffId = worker.id;
    const assignedBranchId = worker.branch_id;

    // Check slot is still free for the assigned staff (prevent race condition)
    const conflict = await sql`
      SELECT id FROM bookings
      WHERE salon_id    = ${salon.id}
        AND staff_id    = ${assignedStaffId}
        AND booking_date = ${booking_date}
        AND status IN ('pending', 'confirmed')
        AND start_time < ${end_time}
        AND end_time   > ${start_time}
    `;
    if (conflict.length > 0) {
      return NextResponse.json(
        { error: 'That slot was just taken. Please pick another time.' },
        { status: 409 }
      );
    }

    // Rate limit: max 3 pending/confirmed bookings per phone per salon per day
    const [rateCheck] = await sql`
      SELECT COUNT(*) AS cnt FROM bookings
      WHERE salon_id    = ${salon.id}
        AND guest_phone = ${guest_phone.trim()}
        AND booking_date = ${booking_date}
        AND status IN ('pending', 'confirmed')
    `;
    if (Number(rateCheck?.cnt ?? 0) >= 3) {
      return NextResponse.json(
        { error: 'Maximum bookings reached for this phone number on this date.' },
        { status: 429 }
      );
    }

    // Generate booking number
    const bookingNumber = await generateBookingNumber(salon.id, salon.subdomain ?? subdomain);

    // Create booking — branch_id is inferred from the assigned worker's branch
    const [booking] = await sql`
      INSERT INTO bookings (
        salon_id, branch_id, guest_name, guest_phone,
        staff_id, service_id,
        booking_date, start_time, end_time,
        status, notes, booking_number
      ) VALUES (
        ${salon.id}, ${assignedBranchId}, ${guest_name.trim()}, ${guest_phone.trim()},
        ${assignedStaffId}, ${service_id},
        ${booking_date}, ${start_time}, ${end_time},
        'pending', ${notes?.trim() || null}, ${bookingNumber}
      )
      RETURNING id, booking_number, public_token, status, created_at
    `;

    // Send SMS notifications (non-blocking)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const formattedDate = new Date(booking_date + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const formattedTime = start_time.slice(0, 5);

    sendBookingConfirmationSms({
      customerPhone: guest_phone.trim(),
      customerName: guest_name.trim(),
      bookingNumber,
      salonName: salon.name,
      bookingDate: formattedDate,
      startTime: formattedTime,
      serviceName: service.name,
      appUrl,
    });

    if (salon.phone) {
      sendNewBookingAlertSms({
        ownerPhone: salon.phone,
        customerName: guest_name.trim(),
        customerPhone: guest_phone.trim(),
        bookingNumber,
        bookingDate: formattedDate,
        startTime: formattedTime,
        serviceName: service.name,
      });
    }

    return NextResponse.json({
      bookingNumber: booking.booking_number,
      status: booking.status,
      salonName: salon.name,
      salonPhone: salon.phone,
      serviceName: service.name,
      servicePrice: Number(service.price),
      staffName: worker.name,
      bookingDate: booking_date,
      startTime: start_time,
      endTime: end_time,
      guestName: guest_name.trim(),
      guestPhone: guest_phone.trim(),
      createdAt: booking.created_at,
    }, { status: 201 });

  } catch (err) {
    console.error('bookings/create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
