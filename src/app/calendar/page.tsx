import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import { sql } from '@/lib/db';
import CalendarView from './CalendarView';
import type { Service } from '@/types';

// Deliberately not linked from any nav — this page is only meant to be
// reached by whoever has the direct URL (e.g. staff checking their own
// schedule), so it's kept out of search engines too.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface StaffOption { id: string; name: string }

// Server component — pre-fetches salon + the filter dropdown options
// (services, staff). The actual booking list is fetched client-side by
// CalendarView since it changes with the user's filters.
export default async function CalendarPage() {
  const h             = await headers();
  const customDomain  = h.get('x-custom-domain') ?? '';
  const subdomain     = h.get('x-salon-subdomain') ?? 'posh';

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

  const staff = await sql`
    SELECT id, name FROM workers
    WHERE salon_id = ${salon.id} AND is_active = true
    ORDER BY name
  `;

  return (
    <CalendarView
      salon={salon}
      services={services as Service[]}
      staff={staff as StaffOption[]}
    />
  );
}
