import { notFound } from 'next/navigation';
import Link from 'next/link';
import { headers } from 'next/headers';
import { sql } from '@/lib/db';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import PrintButton from './PrintButton';

interface Props {
  params: Promise<{ bookingNumber: string }>;
}

function fmtTime(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export default async function ConfirmationPage({ params }: Props) {
  const { bookingNumber } = await params;
  const h = await headers();
  const customDomain = h.get('x-custom-domain') ?? '';
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';
  const salon        = customDomain
    ? await getSalonByDomain(customDomain)
    : await getSalonBySubdomain(subdomain);
  if (!salon) notFound();

  const [booking] = await sql`
    SELECT
      b.booking_number, b.status,
      b.guest_name, b.guest_phone,
      b.booking_date::text, b.start_time::text, b.end_time::text,
      b.notes, b.created_at,
      s.name  AS service_name, s.price AS service_price,
      w.name  AS staff_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN workers  w ON w.id = b.staff_id
    WHERE b.salon_id      = ${salon.id}
      AND b.booking_number = ${bookingNumber.trim().toUpperCase()}
    LIMIT 1
  `;
  if (!booking) notFound();

  const formattedDate = new Date(booking.booking_date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const isPending   = booking.status === 'pending';
  const isConfirmed = booking.status === 'confirmed';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4 no-print">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {salon.logo_url && (
            <img
              src={salon.logo_url}
              alt={salon.name}
              className="h-11 w-11 rounded-lg object-contain border border-slate-100 bg-white"
            />
          )}
          <h1 className="text-xl font-semibold text-slate-900">{salon.name}</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Status banner */}
        <div className={`rounded-xl p-4 border ${isConfirmed ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className={`font-semibold text-base ${isConfirmed ? 'text-green-800' : 'text-amber-800'}`}>
            {isConfirmed ? '✓ Booking Confirmed!' : 'Booking Received'}
          </p>
          <p className={`text-sm mt-0.5 ${isConfirmed ? 'text-green-700' : 'text-amber-700'}`}>
            {isConfirmed
              ? 'Your appointment is confirmed. See you soon!'
              : 'We\'ve received your request. We\'ll confirm it shortly.'}
          </p>
        </div>

        {/* Booking reference — most important box */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase mb-3">Your Booking Reference</p>
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-slate-900 tracking-wider font-mono">
              {booking.booking_number}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <span>📱</span>
            <span>Phone used: <strong className="font-semibold">{booking.guest_phone}</strong></span>
          </div>
          <p className="mt-3 text-xs text-slate-500 text-center">
            Save this Booking ID and the phone number above — you need both to check or manage your appointment.
          </p>
        </div>

        {/* Appointment details */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase mb-4">Appointment Details</p>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Guest</dt>
              <dd className="text-sm font-medium text-slate-900">{booking.guest_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Service</dt>
              <dd className="text-sm font-medium text-slate-900">{booking.service_name}</dd>
            </div>
            {booking.staff_name && (
              <div className="flex justify-between">
                <dt className="text-sm text-slate-500">Stylist</dt>
                <dd className="text-sm font-medium text-slate-900">{booking.staff_name}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Date</dt>
              <dd className="text-sm font-medium text-slate-900">{formattedDate}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Time</dt>
              <dd className="text-sm font-medium text-slate-900">{fmtTime(booking.start_time)} – {fmtTime(booking.end_time)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-3 mt-1">
              <dt className="text-sm font-semibold text-slate-700">Price</dt>
              <dd className="text-sm font-bold text-slate-900">UGX {Number(booking.service_price).toLocaleString()}</dd>
            </div>
          </dl>
          {booking.notes && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-500">Notes: {booking.notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="no-print flex gap-3">
          <PrintButton />
          <Link
            href="/bookings/check"
            className="flex-1 py-3 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium text-center hover:bg-slate-50"
          >
            Manage Booking
          </Link>
        </div>

        {salon.phone && (
          <p className="text-center text-sm text-slate-500 no-print">
            Questions? Call <a href={`tel:${salon.phone}`} className="text-[var(--brand)] font-medium">{salon.phone}</a>
          </p>
        )}
      </div>
    </div>
  );
}
