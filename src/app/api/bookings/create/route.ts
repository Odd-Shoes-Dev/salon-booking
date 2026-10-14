import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { generateBookingNumber } from '@/lib/slots';
import { sendBookingConfirmationSms, sendNewBookingAlertSms } from '@/lib/sms';

interface ServiceLine {
  service_id: string;
  staff_id?: string | null;
  start_time: string;
}

// POST /api/bookings/create  — no auth required
// Accepts either a single booking (legacy service_id/staff_id/start_time) or
// multiple services via a `services` array — mirrors the main system's format.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { guest_name, guest_phone, booking_date, notes } = body;

    const serviceLines: ServiceLine[] = Array.isArray(body.services)
      ? body.services
      : [{ service_id: body.service_id, staff_id: body.staff_id, start_time: body.start_time }];

    // Input validation
    if (!guest_name?.trim() || !guest_phone?.trim() || !booking_date || serviceLines.length === 0 ||
        serviceLines.some(l => !l.service_id || !l.start_time)) {
      return NextResponse.json({ error: 'All required fields must be provided.' }, { status: 400 });
    }
    if (guest_name.length > 100 || guest_phone.length > 30) {
      return NextResponse.json({ error: 'Invalid input length.' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return NextResponse.json({ error: 'Invalid date format.' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Minimum advance notice — configurable per salon (booking_settings.min_advance_minutes),
    // checked precisely in East Africa Time regardless of server timezone.
    const [settings] = await sql`SELECT min_advance_minutes FROM booking_settings WHERE salon_id = ${salon.id}`;
    const minAdvance = settings?.min_advance_minutes ?? 60;

    const now = new Date();
    const localNow  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
    const localDate = localNow.toISOString().split('T')[0];
    const currentMin = localNow.getHours() * 60 + localNow.getMinutes();

    const [by, bm, bd] = booking_date.split('-').map(Number);
    const [ly, lm, ld] = localDate.split('-').map(Number);
    const dayDiff = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ly, lm - 1, ld)) / 86400000);

    if (dayDiff < 0) {
      return NextResponse.json({ error: 'Cannot book a date in the past.' }, { status: 400 });
    }
    for (const line of serviceLines) {
      const [sh, sm] = line.start_time.split(':').map(Number);
      const requestedMin = dayDiff * 1440 + sh * 60 + sm;
      if (requestedMin < currentMin + minAdvance) {
        return NextResponse.json(
          { error: `Bookings require at least ${minAdvance} minutes notice. For sooner appointments please call us directly.` },
          { status: 400 }
        );
      }
    }

    // Rate limit: max 3 pending/confirmed bookings per phone per salon per day,
    // counting this request's own lines so a multi-service request can't bypass it.
    const [rateCheck] = await sql`
      SELECT COUNT(*) AS cnt FROM bookings
      WHERE salon_id    = ${salon.id}
        AND guest_phone = ${guest_phone.trim()}
        AND booking_date = ${booking_date}
        AND status IN ('pending', 'confirmed')
    `;
    if (Number(rateCheck?.cnt ?? 0) + serviceLines.length > 3) {
      return NextResponse.json(
        { error: 'Maximum bookings reached for this phone number on this date.' },
        { status: 429 }
      );
    }

    const createdBookings: { bookingNumber: string; serviceName: string; staffName: string; startTime: string; endTime: string; price: number }[] = [];

    for (const line of serviceLines) {
      // Verify service belongs to this salon
      const [service] = await sql`
        SELECT id, name, price, duration_minutes FROM services
        WHERE id = ${line.service_id} AND salon_id = ${salon.id} AND is_active = true
      `;
      if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });

      const [sh, sm] = line.start_time.split(':').map(Number);
      const endMinutes = sh * 60 + sm + service.duration_minutes;
      const end_time = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

      // Verify staff belongs to this salon — or auto-assign one if "Any Staff" selected
      let worker: { id: string; name: string; branch_id: string | null } | null = null;
      if (line.staff_id) {
        const [found] = await sql`
          SELECT id, name, branch_id FROM workers
          WHERE id = ${line.staff_id} AND salon_id = ${salon.id} AND is_active = true
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
                AND end_time   > ${line.start_time}
            )
          ORDER BY name
          LIMIT 1
        `;
        if (!found) return NextResponse.json({ error: `No staff available for ${service.name} at that time. Please try a different slot.` }, { status: 409 });
        worker = found as { id: string; name: string; branch_id: string | null };
      }

      // Check slot is still free for the assigned staff (prevent race condition,
      // and prevent two lines in this same request double-booking one staff member)
      const conflict = await sql`
        SELECT id FROM bookings
        WHERE salon_id    = ${salon.id}
          AND staff_id    = ${worker.id}
          AND booking_date = ${booking_date}
          AND status IN ('pending', 'confirmed')
          AND start_time < ${end_time}
          AND end_time   > ${line.start_time}
      `;
      if (conflict.length > 0) {
        return NextResponse.json(
          { error: `The slot for ${service.name} was just taken. Please pick another time.` },
          { status: 409 }
        );
      }

      const bookingNumber = await generateBookingNumber(salon.id, salon.subdomain ?? subdomain);

      // Create booking — branch_id is inferred from the assigned worker's branch
      const [booking] = await sql`
        INSERT INTO bookings (
          salon_id, branch_id, guest_name, guest_phone,
          staff_id, service_id,
          booking_date, start_time, end_time,
          status, notes, booking_number
        ) VALUES (
          ${salon.id}, ${worker.branch_id}, ${guest_name.trim()}, ${guest_phone.trim()},
          ${worker.id}, ${line.service_id},
          ${booking_date}, ${line.start_time}, ${end_time},
          'pending', ${notes?.trim() || null}, ${bookingNumber}
        )
        RETURNING booking_number
      `;

      createdBookings.push({
        bookingNumber: booking.booking_number,
        serviceName: service.name,
        staffName: worker.name,
        startTime: line.start_time,
        endTime: end_time,
        price: Number(service.price),
      });
    }

    // Send SMS notifications once, summarizing every service booked (non-blocking)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const formattedDate = new Date(booking_date + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const serviceSummary = createdBookings.map(b => b.serviceName).join(', ');
    const firstTime = createdBookings[0].startTime.slice(0, 5);
    const refSummary = createdBookings.map(b => b.bookingNumber).join(', ');

    sendBookingConfirmationSms({
      customerPhone: guest_phone.trim(),
      customerName: guest_name.trim(),
      bookingNumber: refSummary,
      salonName: salon.name,
      bookingDate: formattedDate,
      startTime: firstTime,
      serviceName: serviceSummary,
      appUrl,
    });

    if (salon.phone) {
      sendNewBookingAlertSms({
        ownerPhone: salon.phone,
        customerName: guest_name.trim(),
        customerPhone: guest_phone.trim(),
        bookingNumber: refSummary,
        bookingDate: formattedDate,
        startTime: firstTime,
        serviceName: serviceSummary,
      });
    }

    return NextResponse.json({
      bookingNumbers: createdBookings.map(b => b.bookingNumber),
      bookingNumber: createdBookings[0].bookingNumber, // legacy single-booking consumers
      status: 'pending',
      salonName: salon.name,
      salonPhone: salon.phone,
      bookings: createdBookings,
      bookingDate: booking_date,
      guestName: guest_name.trim(),
      guestPhone: guest_phone.trim(),
    }, { status: 201 });

  } catch (err) {
    console.error('bookings/create error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
