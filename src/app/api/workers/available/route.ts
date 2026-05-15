import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// GET /api/workers/available?date=YYYY-MM-DD
// Returns staff who have a schedule for that day.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    const dayOfWeek = new Date(date).getDay();

    // Workers who have an explicit schedule for this day
    let workers = await sql`
      SELECT DISTINCT w.id, w.name
      FROM workers w
      JOIN staff_schedules ss ON ss.staff_id = w.id
      WHERE w.salon_id     = ${salon.id}
        AND w.is_active    = true
        AND ss.salon_id    = ${salon.id}
        AND ss.day_of_week = ${dayOfWeek}
        AND ss.is_available = true
      ORDER BY w.name
    `;

    // No schedules configured yet — fall back to all active workers (same as POS)
    if (workers.length === 0) {
      workers = await sql`
        SELECT id, name FROM workers
        WHERE salon_id = ${salon.id} AND is_active = true
        ORDER BY name
      `;
    }

    return NextResponse.json(workers);
  } catch (err) {
    console.error('workers/available error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
