import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// GET /api/salon/info
// Returns public salon info + booking settings. No auth required.
export async function GET(request: NextRequest) {
  try {
    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';

    const salon = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);

    if (!salon) {
      return NextResponse.json({ error: 'Salon not found' }, { status: 404 });
    }

    const [settings] = await sql`
      SELECT is_enabled, buffer_minutes, advance_booking_days,
             min_advance_minutes, cancellation_hours,
             working_hours_start::text, working_hours_end::text
      FROM booking_settings
      WHERE salon_id = ${salon.id}
    `;

    return NextResponse.json({ salon, settings: settings ?? null });
  } catch (err) {
    console.error('salon/info error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
