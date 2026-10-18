import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/auth';

export async function GET() {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const vouchers = await sql`
    SELECT code, value, remaining_value, status, expires_at, note, created_at
    FROM coupons
    WHERE salon_id  = ${client.salon_id}
      AND client_id = ${client.id}
      AND status != 'cancelled'
    ORDER BY created_at DESC
  `;

  return NextResponse.json(vouchers);
}
