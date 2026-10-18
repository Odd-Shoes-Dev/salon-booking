import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { createClientSession, CLIENT_SESSION_COOKIE } from '@/lib/auth';

const MAX_ATTEMPTS = 5;

// POST /api/auth/verify-otp — no auth required
// Body: { phone, code, name? }
// If the phone has no matching client yet, responds { requiresName: true } without
// consuming the code — resubmit the same { phone, code, name } to finish signup.
export async function POST(request: NextRequest) {
  try {
    const { phone, code, name } = await request.json();
    if (!phone?.trim() || !code?.trim()) {
      return NextResponse.json({ error: 'Phone and code are required.' }, { status: 400 });
    }
    const trimmedPhone = phone.trim();

    const host      = request.headers.get('x-custom-domain') ?? '';
    const subdomain = request.headers.get('x-salon-subdomain') ?? 'posh';
    const salon     = host
      ? await getSalonByDomain(host)
      : await getSalonBySubdomain(subdomain);
    if (!salon) return NextResponse.json({ error: 'Salon not found' }, { status: 404 });

    const [otp] = await sql`
      SELECT id, code_hash, attempts FROM client_otp_requests
      WHERE salon_id = ${salon.id} AND phone = ${trimmedPhone}
        AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!otp) {
      return NextResponse.json({ error: 'Code expired or not found. Please request a new one.' }, { status: 400 });
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 });
    }

    const isValid = await bcrypt.compare(code.trim(), otp.code_hash);
    if (!isValid) {
      await sql`UPDATE client_otp_requests SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return NextResponse.json({ error: 'Incorrect code.' }, { status: 400 });
    }

    // Code is correct — find or create the client, but don't consume the code
    // until we actually finish (so a "need your name" round trip can reuse it).
    const [existingClient] = await sql`
      SELECT id FROM clients WHERE salon_id = ${salon.id} AND phone = ${trimmedPhone} AND is_active = true
    `;

    let clientId: string;
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      if (!name?.trim()) {
        return NextResponse.json({ requiresName: true });
      }
      if (name.trim().length > 100) {
        return NextResponse.json({ error: 'Name is too long.' }, { status: 400 });
      }

      let registrationBranchId: string | null = null;
      const [firstBranch] = await sql`
        SELECT id FROM branches WHERE salon_id = ${salon.id} AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1
      `;
      registrationBranchId = firstBranch?.id ?? null;

      const [newClient] = await sql`
        INSERT INTO clients (salon_id, name, phone, registered_at_branch_id)
        VALUES (${salon.id}, ${name.trim()}, ${trimmedPhone}, ${registrationBranchId})
        RETURNING id
      `;
      clientId = newClient.id;
    }

    await sql`UPDATE client_otp_requests SET consumed_at = NOW() WHERE id = ${otp.id}`;

    const { token, expiresAt } = await createClientSession(clientId, salon.id);

    const response = NextResponse.json({ success: true });
    response.cookies.set(CLIENT_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('verify-otp error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
