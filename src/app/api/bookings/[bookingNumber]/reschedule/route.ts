import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { getAvailableSlots } from '@/lib/slots';
import { hoursUntilEAT } from '@/lib/time';
import { sendRescheduleConfirmationSms, sendRescheduleAlertSms } from '@/lib/sms';

// POST /api/bookings/[bookingNumber]/reschedule
// Body: { guest_phone, new_date, new_start_time, new_end_time, new_staff_id? }
// new_staff_id: a specific worker id to switch to, the string 'any' to let
// the system assign whoever's free for the new slot, or omitted to keep the
// booking's current staff member (the original, pre-staff-picker behavior).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bookingNumber: string }> }
) {
  try {
    const { bookingNumber } = await params;
    const body = await request.json();
    const { guest_phone, new_date, new_start_time, new_end_time, new_staff_id } = body;

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
    // ::text casts matter here — the Neon driver returns plain date/time
    // columns as JS Date objects, not strings, and hoursUntilEAT() below
    // calls .split() expecting a real string.
    const [booking] = await sql`
      SELECT id, status, guest_name, guest_phone, booking_number,
             booking_date::text, start_time::text, end_time::text,
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
    const hoursUntil = hoursUntilEAT(booking.booking_date, booking.start_time);
    if (hoursUntil <= cancellationHours) {
      return NextResponse.json(
        { error: `Reschedules must be made at least ${cancellationHours} hours before the appointment.` },
        { status: 400 }
      );
    }

    // Resolve which staff member this slot is checked against. A specific
    // new_staff_id must belong to this salon; 'any' (or an explicit choice)
    // both get validated the same way getAvailableSlots already validates
    // the original staff_id — only the id being checked differs.
    let requestedStaffId: string | undefined;
    if (new_staff_id && new_staff_id !== 'any') {
      const [worker] = await sql`SELECT id FROM workers WHERE id = ${new_staff_id} AND salon_id = ${salon.id} AND is_active = true`;
      if (!worker) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 });
      requestedStaffId = worker.id;
    } else if (new_staff_id === 'any') {
      requestedStaffId = undefined; // union across all staff — pick one below
    } else {
      requestedStaffId = booking.staff_id; // unchanged — original behavior
    }

    // Check the new slot is free — getAvailableSlots enforces the salon's
    // configured minimum advance notice internally, so a too-soon slot simply
    // won't appear here.
    const [service] = await sql`SELECT duration_minutes FROM services WHERE id = ${booking.service_id}`;
    const slots = await getAvailableSlots(
      salon.id, new_date, service?.duration_minutes ?? 60, requestedStaffId
    );
    const matchedSlot = slots.find(
      s => s.startTime === new_start_time.slice(0, 5) && s.endTime === new_end_time.slice(0, 5)
    );
    if (!matchedSlot) {
      return NextResponse.json({ error: 'That time slot is no longer available.' }, { status: 409 });
    }

    // For an explicit staff member this is just them; for 'any' it's
    // whoever getAvailableSlots found free for this slot — pick the first.
    const finalStaffId = requestedStaffId ?? matchedSlot.availableStaff[0]?.id;
    if (!finalStaffId) {
      return NextResponse.json({ error: 'No staff available for that slot.' }, { status: 409 });
    }
    const [finalWorker] = await sql`SELECT name, branch_id FROM workers WHERE id = ${finalStaffId}`;

    await sql`
      UPDATE bookings
      SET booking_date   = ${new_date},
          start_time     = ${new_start_time},
          end_time       = ${new_end_time},
          status         = 'pending',
          rescheduled_at = NOW(),
          staff_id       = ${finalStaffId},
          branch_id      = ${finalWorker?.branch_id ?? null}
      WHERE id = ${booking.id}
    `;

    // Notify both sides, non-blocking — the reschedule already succeeded.
    const formattedDate = new Date(new_date + 'T12:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const formattedTime = new_start_time.slice(0, 5);
    const customerName = booking.guest_name ?? 'there';

    sendRescheduleConfirmationSms({
      customerPhone: booking.guest_phone,
      customerName,
      bookingNumber: booking.booking_number,
      salonName: salon.name,
      newDate: formattedDate,
      newStartTime: formattedTime,
    });

    if (salon.phone) {
      sendRescheduleAlertSms({
        ownerPhone: salon.phone,
        customerName,
        customerPhone: booking.guest_phone,
        bookingNumber: booking.booking_number,
        newDate: formattedDate,
        newStartTime: formattedTime,
      });
    }

    return NextResponse.json({
      success: true,
      newDate: new_date,
      newStartTime: new_start_time,
      newStaffId: finalStaffId,
      newStaffName: finalWorker?.name ?? null,
    });
  } catch (err) {
    console.error('reschedule error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
