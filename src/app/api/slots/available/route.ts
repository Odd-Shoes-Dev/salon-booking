import { NextRequest, NextResponse } from 'next/server';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { getAvailableSlots } from '@/lib/slots';

// GET /api/slots/available?date=YYYY-MM-DD&serviceDuration=60&staffId=optional-uuid
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date            = searchParams.get('date');
    const durationParam   = searchParams.get('serviceDuration');
    const staffId         = searchParams.get('staffId') ?? undefined;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 });
    }
    const duration = Number(durationParam);
    if (!duration || duration < 1) {
      return NextResponse.json({ error: 'serviceDuration param required' }, { status: 400 });
    }

    // Enforce 48-hour minimum for self-bookings
    const minDate = new Date();
    minDate.setMinutes(minDate.getMinutes() + 2880); // +48h
    if (new Date(date) < new Date(minDate.toISOString().slice(0, 10))) {
      return NextResponse.json(
        { error: 'Self-bookings require at least 48 hours notice. Please call us for sooner appointments.' },
        { status: 400 }
      );
    }

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    const slots = await getAvailableSlots(salon.id, date, duration, staffId);
    return NextResponse.json(slots);
  } catch (err) {
    console.error('slots/available error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
