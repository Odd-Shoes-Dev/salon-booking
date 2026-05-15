import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Domain convention — set NEXT_PUBLIC_ROOT_DOMAIN in .env to change the provider.
 *
 *   Owned-domain salons
 *     Booking  →  {slug}.ROOT_DOMAIN           e.g. posh.blueoxgroup.eu
 *     System   →  system-{slug}.ROOT_DOMAIN    e.g. system-posh.blueoxgroup.eu
 *
 *   Custom-domain salons
 *     Booking  →  customdomain.com
 *     System   →  system.customdomain.com
 *
 * This middleware handles the BOOKING side.
 * If a system-side URL reaches this app it redirects to the matching booking URL.
 */
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'blueoxgroup.eu';

export function middleware(request: NextRequest) {
  const hostname    = request.headers.get('host') ?? '';
  const withoutPort = hostname.split(':')[0];
  const normalized  = withoutPort.replace(/^www\./, '');
  const parts       = normalized.split('.');

  const isLocalDev    = normalized === 'localhost' || normalized.startsWith('127.');
  const isVercelPrev  = hostname.includes('.vercel.app');
  const isOwnedDomain = normalized === ROOT_DOMAIN || normalized.endsWith('.' + ROOT_DOMAIN);
  const isCustomDomain = !isLocalDev && !isVercelPrev && !isOwnedDomain && parts.length >= 2;

  let subdomain    = '';
  let customDomain = '';

  if (isLocalDev || isVercelPrev) {
    // Default salon for local dev and Vercel preview deployments
    subdomain = 'posh';

  } else if (isCustomDomain) {
    if (parts[0] === 'system') {
      // system.salon.com hits booking app → redirect to salon.com (booking URL)
      const dest = new URL(request.url);
      dest.hostname = parts.slice(1).join('.');
      return NextResponse.redirect(dest, 301);
    }
    // salon.com → booking side ✓
    customDomain = normalized;

  } else {
    // Owned domain: {slug}.ROOT_DOMAIN  OR  system-{slug}.ROOT_DOMAIN
    const rawSub = parts[0];
    if (rawSub.startsWith('system-')) {
      // system-{slug}.ROOT_DOMAIN hits booking app → redirect to {slug}.ROOT_DOMAIN
      const dest = new URL(request.url);
      dest.hostname = `${rawSub.slice('system-'.length)}.${ROOT_DOMAIN}`;
      return NextResponse.redirect(dest, 301);
    } else if (rawSub === ROOT_DOMAIN.split('.')[0] || rawSub === 'www') {
      // Bare root domain — no salon context, let it through
      subdomain = '';
    } else {
      // {slug}.ROOT_DOMAIN → booking side ✓
      subdomain = rawSub;
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-salon-subdomain', subdomain);
  if (customDomain) requestHeaders.set('x-custom-domain', customDomain);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
};
