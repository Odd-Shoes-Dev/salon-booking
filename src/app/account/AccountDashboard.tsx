'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';
import type { Salon } from '@/types';

export interface AccountBooking {
  booking_number: string;
  status: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  service_name: string;
  service_price: number;
  staff_name: string | null;
}

export interface AccountVoucher {
  code: string;
  value: number;
  remaining_value: number;
  status: string;
  expires_at: string | null;
  note: string | null;
}

interface ClientInfo {
  name: string;
  phone: string;
  loyalty_points: number;
}

interface Props {
  salon: Salon;
  client: ClientInfo;
  initialBookings: AccountBooking[];
  initialVouchers: AccountVoucher[];
}

function fmtTime(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending Confirmation', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  confirmed: { label: 'Confirmed',             color: 'text-green-700 bg-green-50 border-green-200' },
  cancelled: { label: 'Cancelled',             color: 'text-red-700 bg-red-50 border-red-200' },
  completed: { label: 'Completed',             color: 'text-slate-700 bg-slate-50 border-slate-200' },
  no_show:   { label: 'No Show',               color: 'text-slate-500 bg-slate-50 border-slate-200' },
};

export default function AccountDashboard({ salon, client, initialBookings, initialVouchers }: Props) {
  const router = useRouter();
  const [bookings, setBookings] = useState(initialBookings);
  const [cancellingNumber, setCancellingNumber] = useState<string | null>(null);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  const cancelBooking = async (bookingNumber: string) => {
    setCancellingNumber(bookingNumber);
    try {
      const res = await fetch(`/api/bookings/${bookingNumber}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_phone: client.phone, reason: 'Cancelled by customer' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to cancel booking.'); return; }
      toast.success('Booking cancelled.');
      setBookings(prev => prev.map(b => b.booking_number === bookingNumber ? { ...b, status: 'cancelled' } : b));
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setCancellingNumber(null);
    }
  };

  const upcoming = bookings.filter(b => ['pending', 'confirmed'].includes(b.status));
  const past     = bookings.filter(b => !['pending', 'confirmed'].includes(b.status));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {salon.logo_url && (
              <img src={salon.logo_url} alt={salon.name} className="h-11 w-11 rounded-lg object-contain border border-slate-100 bg-white" />
            )}
            <h1 className="text-xl font-semibold text-slate-900">{salon.name}</h1>
          </div>
          <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-700">Log Out</button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Profile + loyalty */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <p className="text-xs text-slate-500 mb-0.5">Logged in as</p>
          <p className="font-semibold text-slate-900 text-lg">{client.name}</p>
          <p className="text-sm text-slate-500">{client.phone}</p>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-sm text-slate-500">Loyalty Points</span>
            <span className="text-lg font-bold text-[var(--brand)]">{client.loyalty_points}</span>
          </div>
        </div>

        <Link
          href="/booking"
          className="block w-full py-3 rounded-xl bg-[var(--brand)] text-white font-medium text-center"
        >
          + New Booking
        </Link>

        {/* Vouchers */}
        {initialVouchers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Your Vouchers</h2>
            <div className="space-y-2">
              {initialVouchers.map(v => (
                <div key={v.code} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="font-mono font-semibold text-slate-900 text-sm">{v.code}</p>
                    {v.note && <p className="text-xs text-slate-500">{v.note}</p>}
                  </div>
                  <span className="text-sm font-bold text-[var(--brand)]">UGX {Number(v.remaining_value).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming bookings */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Upcoming Bookings</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">No upcoming bookings.</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map(b => {
                const statusInfo = STATUS_LABELS[b.status] ?? { label: b.status, color: 'text-slate-600 bg-slate-50 border-slate-200' };
                return (
                  <div key={b.booking_number} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{b.service_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(b.booking_date)} · {fmtTime(b.start_time)}
                          {b.staff_name ? ` · ${b.staff_name}` : ''}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border shrink-0 ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                      <span className="text-xs text-slate-400">Ref: {b.booking_number}</span>
                      <div className="flex gap-3">
                        <Link href="/bookings/check" className="text-xs text-[var(--brand)] hover:underline">Reschedule</Link>
                        <button
                          onClick={() => cancelBooking(b.booking_number)}
                          disabled={cancellingNumber === b.booking_number}
                          className="text-xs text-red-600 hover:underline disabled:opacity-40"
                        >
                          {cancellingNumber === b.booking_number ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Past bookings */}
        {past.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Past Bookings</h2>
            <div className="space-y-3">
              {past.map(b => {
                const statusInfo = STATUS_LABELS[b.status] ?? { label: b.status, color: 'text-slate-600 bg-slate-50 border-slate-200' };
                return (
                  <div key={b.booking_number} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{b.service_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatDate(b.booking_date)} · {fmtTime(b.start_time)}
                          {b.staff_name ? ` · ${b.staff_name}` : ''}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border shrink-0 ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
