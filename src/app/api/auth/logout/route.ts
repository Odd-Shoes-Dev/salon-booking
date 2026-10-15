import { NextResponse } from 'next/server';
import { destroyClientSession, CLIENT_SESSION_COOKIE } from '@/lib/auth';

export async function POST() {
  await destroyClientSession();
  const response = NextResponse.json({ success: true });
  response.cookies.set(CLIENT_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
