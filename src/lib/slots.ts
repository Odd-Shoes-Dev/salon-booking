import { sql } from '@/lib/db';
import type { AvailableSlot } from '@/types';

/**
 * Returns available time slots for a given salon + date + optional staff filter.
 *
 * Logic:
 *  1. Load booking_settings for the salon (fallback working hours, buffer, min notice)
 *  2. Load each eligible staff member's OWN schedule for the day (start/end/availability),
 *     falling back to the salon's working hours only for staff with no schedule row —
 *     mirrors the main system's per-staff availability logic exactly.
 *  3. Generate potential slots across the union of all staff windows
 *  4. For each slot, keep only staff whose own window covers it and who have no
 *     conflicting booking (existing bookings ± buffer)
 *  5. Return only slots where at least one staff member is free for the full service duration
 */
export async function getAvailableSlots(
  salonId: string,
  date: string,          // 'YYYY-MM-DD'
  serviceDurationMinutes: number,
  staffId?: string
): Promise<AvailableSlot[]> {
  // 1. Booking settings — fallback working hours only, used when a staff member
  // has no schedule row for this day (same defaults as the main system).
  const [settings] = await sql`
    SELECT working_hours_start, working_hours_end, buffer_minutes, min_advance_minutes
    FROM booking_settings
    WHERE salon_id = ${salonId}
  `;

  const fallbackStart = settings?.working_hours_start ?? '07:00';
  const fallbackEnd    = settings?.working_hours_end   ?? '23:00';
  const buffer     = settings?.buffer_minutes       ?? 15;
  const minAdvance = settings?.min_advance_minutes  ?? 60;

  // Parse as local calendar date, not UTC — new Date('YYYY-MM-DD') parses as UTC
  // midnight, which can shift the weekday by one depending on the server's own
  // timezone and misalign staff_schedules.day_of_week.
  const [dy, dm, dd] = date.split('-').map(Number);
  const dayOfWeek = new Date(dy, dm - 1, dd).getDay(); // 0 = Sunday

  // Same-day cutoff, computed in East Africa Time regardless of server timezone
  const now = new Date();
  const localNow  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  const localDate = localNow.toISOString().split('T')[0];
  if (date < localDate) return []; // fully past date

  // 2. Load staff with their own schedule for this day (LEFT JOIN — a worker with
  // no schedule row for today still gets a slot window via the fallback below).
  const staffRows = await sql`
    SELECT w.id, w.name,
           sch.start_time::text AS start_time, sch.end_time::text AS end_time,
           sch.is_available
    FROM workers w
    LEFT JOIN staff_schedules sch
      ON sch.staff_id = w.id AND sch.salon_id = ${salonId} AND sch.day_of_week = ${dayOfWeek}
    WHERE w.salon_id  = ${salonId}
      AND w.is_active = true
      AND (${staffId ?? null}::uuid IS NULL OR w.id = ${staffId ?? null}::uuid)
  `;

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const eligibleStaff = (staffRows as { id: string; name: string; start_time: string | null; end_time: string | null; is_available: boolean | null }[])
    .filter(st => st.is_available !== false) // explicitly off today → excluded; no schedule row → still eligible
    .map(st => ({
      id: st.id,
      name: st.name,
      startMin: toMin(st.start_time ?? fallbackStart),
      endMin:   toMin(st.end_time   ?? fallbackEnd),
    }));

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

  // 4. Generate slots (30-minute increments) across the union of all staff windows
  const slots: AvailableSlot[] = [];
  const slotStep = 30; // minutes between slot start times

  const overallStart = Math.min(...eligibleStaff.map(s => s.startMin));
  const overallEnd   = Math.max(...eligibleStaff.map(s => s.endMin));

  const toHHMM = (totalMin: number) => {
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const isToday = date === localDate;
  const currentMin = isToday ? localNow.getHours() * 60 + localNow.getMinutes() : 0;

  for (let slotStart = overallStart; slotStart + serviceDurationMinutes <= overallEnd; slotStart += slotStep) {
    // Skip slots inside today's minimum-advance-notice window
    if (isToday && slotStart < currentMin + minAdvance) continue;

    const slotEnd    = slotStart + serviceDurationMinutes;
    const slotEndBuf = slotEnd + buffer;

    // Find staff whose own schedule covers this slot and who have no conflict
    const freeStaff = eligibleStaff.filter(staff => {
      if (slotStart < staff.startMin || slotEnd > staff.endMin) return false;
      return !existingBookings.some(b => {
        if (b.staff_id !== staff.id) return false;
        const bStart = toMin(b.start_time as string);
        const bEnd   = toMin(b.end_time   as string);
        // Overlap check: slot conflicts if not entirely before or after the booking+buffer
        return slotStart < bEnd + buffer && slotEndBuf > bStart;
      });
    });

    if (freeStaff.length > 0) {
      slots.push({
        startTime: toHHMM(slotStart),
        endTime:   toHHMM(slotEnd),
        availableStaff: freeStaff.map(s => ({ id: s.id, name: s.name })),
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
