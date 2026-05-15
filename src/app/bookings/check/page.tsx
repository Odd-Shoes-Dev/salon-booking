import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import CheckBookingClient from './CheckBookingClient';

// Server component - resolves the salon upfront so the header (logo + name)
// renders on the first paint without any client-side fetch.
export default async function CheckBookingPage() {
  const h           = await headers();
  const customDomain = h.get('x-custom-domain') ?? '';
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';

  const salon = customDomain
    ? await getSalonByDomain(customDomain)
    : await getSalonBySubdomain(subdomain);
  if (!salon) notFound();

  return <CheckBookingClient salon={salon} />;
}
