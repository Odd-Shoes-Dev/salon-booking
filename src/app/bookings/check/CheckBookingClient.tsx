'use client';

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import type { Salon } from '@/types';

interface Booking {
  booking_number: string;
  status: string;
  guest_name: string;
  guest_phone: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  service_name: string;
  service_price: number;
  staff_name?: string;
  notes?: string;
  cancellation_reason?: string;
  rescheduled_at?: string;
}

function fmtTime(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending Confirmation', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  confirmed: { label: 'Confirmed',             color: 'text-green-700 bg-green-50 border-green-200' },
  cancelled: { label: 'Cancelled',             color: 'text-red-700 bg-red-50 border-red-200' },
  completed: { label: 'Completed',             color: 'text-slate-700 bg-slate-50 border-slate-200' },
  no_show:   { label: 'No Show',               color: 'text-slate-500 bg-slate-50 border-slate-200' },
};

function getMinDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

interface Props {
  salon: Salon;
}

export default function CheckBookingClient({ salon }: Props) {
  const inputClass = 'w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] text-slate-900 bg-white';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-2';

  // Lookup form
  const [bookingId, setBookingId] = useState('');
  const [phone,     setPhone]     = useState('');
  const [loading,   setLoading]   = useState(false);

  // Booking result
  const [booking,       setBooking]       = useState<Booking | null>(null);
  const [canCancel,     setCanCancel]     = useState(false);
  const [canReschedule, setCanReschedule] = useState(false);

  // Cancel modal
  const [cancelOpen,   setCancelOpen]   = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling,   setCancelling]   = useState(false);

  // Reschedule modal
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate,        setNewDate]        = useState('');
  const [availableSlots, setAvailableSlots] = useState<{ startTime: string; endTime: string }[]>([]);
  const [loadingSlots,   setLoadingSlots]   = useState(false);
  const [newSlot,        setNewSlot]        = useState<{ startTime: string; endTime: string } | null>(null);
  const [rescheduling,   setRescheduling]   = useState(false);

  const handleLookup = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingId.trim() || !phone.trim()) return;
    setLoading(true);
    setBooking(null);
    try {
      const res = await fetch('/api/bookings/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_number: bookingId.trim(), guest_phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Not found'); setLoading(false); return; }
      setBooking(data.booking);
      setCanCancel(data.canCancel);
      setCanReschedule(data.canReschedule);
    } catch {
      toast.error('Network error. Please try again.');
    }
    setLoading(false);
  }, [bookingId, phone]);

  const handleCancel = useCallback(async () => {
    if (!booking) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${booking.booking_number}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_phone: phone.trim(), reason: cancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to cancel'); setCancelling(false); return; }
      toast.success('Booking cancelled.');
      setBooking(prev => prev ? { ...prev, status: 'cancelled' } : null);
      setCanCancel(false);
      setCanReschedule(false);
      setCancelOpen(false);
    } catch {
      toast.error('Network error.');
    }
    setCancelling(false);
  }, [booking, phone, cancelReason]);

  const loadSlotsForDate = useCallback(async (d: string) => {
    if (!booking || !d) return;
    setLoadingSlots(true);
    setAvailableSlots([]);
    setNewSlot(null);
    try {
      const res = await fetch(`/api/slots/available?date=${d}&serviceDuration=60`);
      const data = await res.json();
      setAvailableSlots(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load slots.');
    }
    setLoadingSlots(false);
  }, [booking]);

  const handleReschedule = useCallback(async () => {
    if (!booking || !newSlot || !newDate) return;
    setRescheduling(true);
    try {
      const res = await fetch(`/api/bookings/${booking.booking_number}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_phone: phone.trim(),
          new_date: newDate,
          new_start_time: newSlot.startTime,
          new_end_time: newSlot.endTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to reschedule'); setRescheduling(false); return; }
      toast.success('Booking rescheduled!');
      setBooking(prev => prev ? {
        ...prev,
        booking_date: newDate,
        start_time: newSlot.startTime,
        end_time: newSlot.endTime,
        status: 'pending',
        rescheduled_at: new Date().toISOString(),
      } : null);
      setRescheduleOpen(false);
    } catch {
      toast.error('Network error.');
    }
    setRescheduling(false);
  }, [booking, newDate, newSlot, phone]);

  const statusInfo = booking
    ? (STATUS_LABELS[booking.status] ?? { label: booking.status, color: 'text-slate-700 bg-slate-50 border-slate-200' })
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header — salon data arrives from server, renders immediately */}
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <Link href="/booking" className="text-sm text-slate-500 hover:text-slate-700">← New Booking</Link>
          <div className="flex items-center gap-3 mt-2">
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
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Lookup form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <p className="text-sm text-slate-500 mb-5">Enter your Booking ID and the phone number you used when booking.</p>
          <form onSubmit={handleLookup} className="space-y-4">
            <div>
              <label className={labelClass}>Booking ID</label>
              <input
                type="text"
                value={bookingId}
                onChange={e => setBookingId(e.target.value.slice(0, 50).toUpperCase())}
                placeholder="e.g. POSH-20260515-001"
                className={inputClass + ' font-mono uppercase'}
                autoCapitalize="characters"
              />
            </div>
            <div>
              <label className={labelClass}>Phone Number Used</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value.slice(0, 30))}
                placeholder="+256 700 000 000"
                autoComplete="tel"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !bookingId.trim() || !phone.trim()}
              className="w-full py-3 rounded-lg bg-[var(--brand)] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Searching...</>
              ) : 'Find My Booking'}
            </button>
          </form>
        </div>

        {/* Booking details */}
        {booking && statusInfo && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-slate-500 tracking-widest uppercase">Booking</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-lg font-bold font-mono text-slate-900 mb-4">{booking.booking_number}</p>

              <dl className="space-y-3">
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
                  <dd className="text-sm font-medium text-slate-900">{formatDate(booking.booking_date)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-slate-500">Time</dt>
                  <dd className="text-sm font-medium text-slate-900">{fmtTime(booking.start_time)} – {fmtTime(booking.end_time)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-3">
                  <dt className="text-sm font-semibold text-slate-700">Price</dt>
                  <dd className="text-sm font-bold text-slate-900">UGX {Number(booking.service_price).toLocaleString()}</dd>
                </div>
              </dl>

              {booking.cancellation_reason && (
                <p className="mt-3 text-xs text-slate-500 border-t border-slate-100 pt-3">
                  Cancellation reason: {booking.cancellation_reason}
                </p>
              )}
            </div>

            {/* Action buttons */}
            {(canCancel || canReschedule) && (
              <div className="flex gap-3">
                {canReschedule && (
                  <button
                    onClick={() => setRescheduleOpen(true)}
                    className="flex-1 py-3 rounded-lg border border-[var(--brand)] text-[var(--brand)] text-sm font-medium"
                  >
                    Reschedule
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={() => setCancelOpen(true)}
                    className="flex-1 py-3 rounded-lg border border-red-200 text-red-600 text-sm font-medium"
                  >
                    Cancel Booking
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Cancel modal */}
      {cancelOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Cancel Booking</h3>
            <p className="text-sm text-slate-500 mb-4">This cannot be undone.</p>
            <div className="mb-4">
              <label className={labelClass}>Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value.slice(0, 300))}
                placeholder="e.g. Change of plans"
                rows={2}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-slate-900 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelOpen(false)}
                className="flex-1 py-3 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium"
              >
                Keep Booking
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 py-3 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {rescheduleOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Reschedule Booking</h3>
            <div className="mb-4">
              <label className={labelClass}>New Date</label>
              <input
                type="date"
                min={getMinDate()}
                value={newDate}
                onChange={e => { setNewDate(e.target.value); loadSlotsForDate(e.target.value); }}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] text-slate-900"
              />
            </div>
            {newDate && (
              <div className="mb-4">
                <label className={labelClass}>New Time</label>
                {loadingSlots ? (
                  <p className="text-sm text-slate-500">Loading slots...</p>
                ) : availableSlots.length === 0 ? (
                  <p className="text-sm text-slate-500">No available slots on this date.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map(s => (
                      <button
                        key={s.startTime}
                        onClick={() => setNewSlot(s)}
                        className={`py-2 rounded-lg text-sm font-medium border transition-colors
                          ${newSlot?.startTime === s.startTime
                            ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                            : 'border-slate-200 text-slate-700 hover:border-[var(--brand)]'}`}
                      >
                        {fmtTime(s.startTime)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setRescheduleOpen(false)}
                className="flex-1 py-3 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleReschedule}
                disabled={rescheduling || !newDate || !newSlot}
                className="flex-1 py-3 rounded-lg bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40"
              >
                {rescheduling ? 'Saving...' : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
