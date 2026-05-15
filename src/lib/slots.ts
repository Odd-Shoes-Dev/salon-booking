import { sql } from '@/lib/db';
import type { AvailableSlot } from '@/types';

/**
 * Returns available time slots for a given salon + date + optional staff filter.
 *
 * Logic:
 *  1. Load booking_settings for the salon (working hours, buffer, slot duration)
 *  2. If staffId provided, load that staff member's schedule for the day
 *  3. Generate all potential slots between working_hours_start and working_hours_end
 *  4. For each slot, subtract already-confirmed/pending bookings (which occupy start_time→end_time)
 *  5. Return only slots where at least one staff member is free for the full service duration
 */
export async function getAvailableSlots(
  salonId: string,
  date: string,          // 'YYYY-MM-DD'
  serviceDurationMinutes: number,
  staffId?: string
): Promise<AvailableSlot[]> {
  // 1. Booking settings
  const [settings] = await sql`
    SELECT working_hours_start, working_hours_end, buffer_minutes
    FROM booking_settings
    WHERE salon_id = ${salonId}
  `;

  const workStart = settings?.working_hours_start ?? '09:00';
  const workEnd   = settings?.working_hours_end   ?? '18:00';
  const buffer    = settings?.buffer_minutes       ?? 15;

  const dayOfWeek = new Date(date).getDay(); // 0 = Sunday

  // 2. Load eligible staff for this day
  let eligibleStaff: { id: string; name: string }[] = [];
  if (staffId) {
    const [sched] = await sql`
      SELECT w.id, w.name FROM staff_schedules ss
      JOIN workers w ON w.id = ss.staff_id
      WHERE ss.staff_id = ${staffId}
        AND ss.salon_id = ${salonId}
        AND ss.day_of_week = ${dayOfWeek}
        AND ss.is_available = true
        AND w.is_active = true
    `;
    if (sched) eligibleStaff = [{ id: sched.id, name: sched.name }];
  } else {
    const rows = await sql`
      SELECT DISTINCT w.id, w.name FROM staff_schedules ss
      JOIN workers w ON w.id = ss.staff_id
      WHERE ss.salon_id = ${salonId}
        AND ss.day_of_week = ${dayOfWeek}
        AND ss.is_available = true
        AND w.is_active = true
    `;
    eligibleStaff = rows.map(r => ({ id: r.id, name: r.name }));

    // No schedules configured yet — fall back to all active workers (same as POS)
    if (eligibleStaff.length === 0) {
      const allWorkers = await sql`
        SELECT id, name FROM workers
        WHERE salon_id = ${salonId} AND is_active = true
        ORDER BY name
      `;
      eligibleStaff = allWorkers.map(r => ({ id: r.id, name: r.name }));
    }
  }

  if (eligibleStaff.length === 0) return [];

  // 3. Load existing bookings for this date
  const existingBookings = await sql`
    SELECT staff_id,
           start_time::text AS start_time,
           end_time::text   AS end_time
    FROM bookings
    WHERE salon_id    = ${salonId}
      AND booking_date = ${date}
      AND status IN ('pending', 'confirmed')
  `;

  // 4. Generate slots (30-minute increments)
  const slots: AvailableSlot[] = [];
  const slotStep = 30; // minutes between slot start times

  const [wsh, wsm]  = workStart.split(':').map(Number);
  const [weh, wem]  = workEnd.split(':').map(Number);
  const workStartMin = wsh * 60 + wsm;
  const workEndMin   = weh * 60 + wem;

  const toHHMM = (totalMin: number) => {
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  for (let slotStart = workStartMin; slotStart + serviceDurationMinutes <= workEndMin; slotStart += slotStep) {
    const slotEnd    = slotStart + serviceDurationMinutes;
    const slotEndBuf = slotEnd + buffer;

    // Find staff free for this slot
    const freeStaff = eligibleStaff.filter(staff => {
      return !existingBookings.some(b => {
        if (b.staff_id !== staff.id) return false;
        const [bsh, bsm] = (b.start_time as string).split(':').map(Number);
        const [beh, bem] = (b.end_time   as string).split(':').map(Number);
        const bStart = bsh * 60 + bsm;
        const bEnd   = beh * 60 + bem;
        // Overlap check: slot conflicts if not entirely before or after the booking+buffer
        return slotStart < bEnd + buffer && slotEndBuf > bStart;
      });
    });

    if (freeStaff.length > 0) {
      slots.push({
        startTime: toHHMM(slotStart),
        endTime:   toHHMM(slotEnd),
        availableStaff: freeStaff,
      });
    }
  }

  return slots;
}

/**
 * Generate the next booking number for a salon on today's date.
 * Format: {SLUG}-{YYYYMMDD}-{SEQ} e.g. POSH-20260515-001
 */
export async function generateBookingNumber(salonId: string, subdomain: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug  = subdomain.toUpperCase().slice(0, 6);
  const prefix = `${slug}-${today}-`;

  const [row] = await sql`
    SELECT COUNT(*) AS cnt FROM bookings
    WHERE salon_id = ${salonId}
      AND booking_number LIKE ${prefix + '%'}
  `;

  const seq = (Number(row?.cnt ?? 0) + 1).toString().padStart(3, '0');
  return `${prefix}${seq}`;
}
