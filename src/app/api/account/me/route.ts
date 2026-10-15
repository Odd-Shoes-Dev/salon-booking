import { NextResponse } from 'next/server';
import { getCurrentClient } from '@/lib/auth';

export async function GET() {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  return NextResponse.json({
    name: client.name,
    phone: client.phone,
    loyalty_points: client.loyalty_points,
  });
}
