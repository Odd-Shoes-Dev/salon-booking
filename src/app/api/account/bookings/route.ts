import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/auth';

export async function GET() {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const bookings = await sql`
    SELECT
      b.booking_number, b.status,
      b.booking_date::text, b.start_time::text, b.end_time::text,
      b.notes, b.created_at,
      s.name  AS service_name, s.price AS service_price,
      w.name  AS staff_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN workers  w ON w.id = b.staff_id
    WHERE b.salon_id  = ${client.salon_id}
      AND b.client_id = ${client.id}
    ORDER BY b.booking_date DESC, b.start_time DESC
  `;

  return NextResponse.json(bookings);
}
