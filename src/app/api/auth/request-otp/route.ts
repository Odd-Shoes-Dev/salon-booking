import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { sendOtpSms } from '@/lib/sms';

const OTP_TTL_MINUTES = 10;
const MAX_REQUESTS_PER_WINDOW = 3;
const WINDOW_MINUTES = 10;

// POST /api/auth/request-otp — no auth required
// Body: { phone }
// Always responds success (never reveals whether the phone belongs to a client).
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone?.trim() || phone.length > 30) {
      return NextResponse.json({ error: 'A valid phone number is required.' }, { status: 400 });
    }
    const trimmedPhone = phone.trim();

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    // Rate limit: cap how many codes can be requested per phone in a rolling window
    const [recent] = await sql`
      SELECT COUNT(*) AS cnt FROM client_otp_requests
      WHERE salon_id = ${salon.id} AND phone = ${trimmedPhone}
        AND created_at > NOW() - (${WINDOW_MINUTES} || ' minutes')::interval
    `;
    if (Number(recent?.cnt ?? 0) >= MAX_REQUESTS_PER_WINDOW) {
      return NextResponse.json(
        { error: 'Too many codes requested. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await sql`
      INSERT INTO client_otp_requests (salon_id, phone, code_hash, expires_at)
      VALUES (${salon.id}, ${trimmedPhone}, ${codeHash}, ${expiresAt.toISOString()})
    `;

    sendOtpSms({ customerPhone: trimmedPhone, code, salonName: salon.name });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('request-otp error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
