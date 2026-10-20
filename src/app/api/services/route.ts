import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';

// GET /api/services  — public list of active services for this salon
export async function GET(request: NextRequest) {
  try {
    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Services are grouped by the plain-text `category` column, not the
    // `category_id` FK — the main system's own Services page groups the
    // same way (and even its own API matches categories by this name
    // string), and category_id is never actually populated by it.
    const services = await sql`
      SELECT s.id, s.name, s.price, s.duration_minutes, s.description,
             s.category AS category_name
      FROM services s
      WHERE s.salon_id = ${salon.id}
        AND s.is_active = true
      ORDER BY s.category NULLS LAST, s.name
    `;

    return NextResponse.json(services);
  } catch (err) {
    console.error('services error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
