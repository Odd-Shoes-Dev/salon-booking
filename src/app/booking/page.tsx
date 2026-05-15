import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { sql } from '@/lib/db';
import BookingForm from './BookingForm';
import type { Service } from '@/types';

// Server component — pre-fetches salon + services so the page renders with
// all static data ready. Workers and slots are fetched client-side only when
// the user reaches those steps (they depend on the chosen date / service).
export default async function BookingPage() {
  const h          = await headers();
  const customDomain = h.get('x-custom-domain') ?? '';
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';

  const salon = customDomain
    ? await getSalonByDomain(customDomain)
    : await getSalonBySubdomain(subdomain);
  if (!salon) notFound();

  const services = await sql`
    SELECT s.id, s.name, s.price, s.duration_minutes, s.description,
           c.name AS category_name
    FROM services s
    LEFT JOIN service_categories c ON c.id = s.category_id
    WHERE s.salon_id  = ${salon.id}
      AND s.is_active = true
    ORDER BY c.name NULLS LAST, s.name
  `;

  return <BookingForm salon={salon} initialServices={services as Service[]} />;
}

