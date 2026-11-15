import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// GET /api/workers/closed-days
// Returns which weekdays (0=Sun..6=Sat) the salon is structurally closed on —
// i.e. no active worker is ever scheduled available that day — so the
// booking calendar can grey them out before the customer picks a date and
// discovers "no slots available" the hard way. Mirrors the fallback in
// /api/workers/available: if no schedules are configured at all yet, nothing
// is considered closed (every day falls back to "all active workers").
export async function GET(request: NextRequest) {
  try {
    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    const [{ cnt }] = await sql`
      SELECT COUNT(*) AS cnt FROM staff_schedules WHERE salon_id = ${salon.id}
    `;
    if (Number(cnt) === 0) return NextResponse.json({ closedDays: [] });

    const openRows = await sql`
      SELECT DISTINCT ss.day_of_week
      FROM staff_schedules ss
      JOIN workers w ON w.id = ss.staff_id
      WHERE ss.salon_id = ${salon.id} AND w.salon_id = ${salon.id}
        AND w.is_active = true AND ss.is_available = true
    `;
    const openDays = new Set((openRows as { day_of_week: number }[]).map(r => r.day_of_week));
    const closedDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !openDays.has(d));

    return NextResponse.json({ closedDays });
  } catch (err) {
    console.error('workers/closed-days error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
