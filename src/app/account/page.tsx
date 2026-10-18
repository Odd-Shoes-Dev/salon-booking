import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { getCurrentClient } from '@/lib/auth';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import AccountDashboard, { type AccountBooking, type AccountVoucher } from './AccountDashboard';

export default async function AccountPage() {
  const client = await getCurrentClient();
  if (!client) redirect('/account/login');

  const h           = await headers();
  const customDomain = h.get('x-custom-domain') ?? '';
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';
  const salon = customDomain
    ? await getSalonByDomain(customDomain)
    : await getSalonBySubdomain(subdomain);
  if (!salon) notFound();

  const bookings = await sql`
    SELECT
      b.booking_number, b.status,
      b.booking_date::text, b.start_time::text, b.end_time::text,
      b.notes,
      s.name  AS service_name, s.price AS service_price,
      w.name  AS staff_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN workers  w ON w.id = b.staff_id
    WHERE b.salon_id  = ${salon.id}
      AND b.client_id = ${client.id}
    ORDER BY b.booking_date DESC, b.start_time DESC
  `;

  const vouchers = await sql`
    SELECT code, value, remaining_value, status, expires_at::text, note
    FROM coupons
    WHERE salon_id  = ${salon.id}
      AND client_id = ${client.id}
      AND status != 'cancelled'
    ORDER BY created_at DESC
  `;

  return (
    <AccountDashboard
      salon={salon}
      client={{ name: client.name, phone: client.phone, loyalty_points: client.loyalty_points }}
      initialBookings={bookings as AccountBooking[]}
      initialVouchers={vouchers as AccountVoucher[]}
    />
  );
}
