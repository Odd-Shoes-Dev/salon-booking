import { sql } from '@/lib/db';
import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'client_auth_token';
const SESSION_DAYS = 60;

export interface AuthClient {
  id: string;
  name: string;
  phone: string;
  salon_id: string;
  loyalty_points: number;
}

/** Get the currently logged-in client from the session cookie, or null. */
export async function getCurrentClient(): Promise<AuthClient | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const [session] = await sql`
      SELECT client_id, salon_id FROM client_sessions
      WHERE token = ${token} AND expires_at > NOW()
    `;
    if (!session) return null;

    const [client] = await sql`
      SELECT id, name, phone, salon_id, loyalty_points
      FROM clients
      WHERE id = ${session.client_id} AND salon_id = ${session.salon_id} AND is_active = true
    `;
    if (!client) return null;

    return {
      id: client.id,
      name: client.name,
      phone: client.phone,
      salon_id: client.salon_id,
      loyalty_points: Number(client.loyalty_points ?? 0),
    };
  } catch (error) {
    console.error('getCurrentClient error:', error);
    return null;
  }
}

/** Create a session for a client and return the token + expiry to set as a cookie. */
export async function createClientSession(clientId: string, salonId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await sql`
    INSERT INTO client_sessions (client_id, salon_id, token, expires_at)
    VALUES (${clientId}, ${salonId}, ${token}, ${expiresAt.toISOString()})
  `;

  return { token, expiresAt };
}

export async function destroyClientSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await sql`DELETE FROM client_sessions WHERE token = ${token}`;
  }
}

export const CLIENT_SESSION_COOKIE = COOKIE_NAME;
