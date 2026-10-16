'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Salon, Service } from '@/types';

interface StaffOption { id: string; name: string }

interface CalendarBooking {
  booking_date: string;
  start_time: string;
  end_time: string;
  service_name: string;
  staff_name: string | null;
}

interface Props {
  salon: Salon;
  services: Service[];
  staff: StaffOption[];
}

// Local calendar date, not UTC — avoids the day shifting near midnight
// depending on the browser's own timezone.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export default function CalendarView({ salon, services, staff }: Props) {
  const today = useMemo(() => localDateStr(new Date()), []);
  const defaultTo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return localDateStr(d);
  }, []);

  const [fromDate, setFromDate]   = useState(today);
  const [toDate, setToDate]       = useState(defaultTo);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId]     = useState('');

  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (serviceId) params.set('service_id', serviceId);
    if (staffId) params.set('staff_id', staffId);

    fetch(`/api/calendar?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setBookings(Array.isArray(d) ? d : []))
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [fromDate, toDate, serviceId, staffId]);

  // Group by date for display
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      if (!map.has(b.booking_date)) map.set(b.booking_date, []);
      map.get(b.booking_date)!.push(b);
    }
    return [...map.entries()];
  }, [bookings]);

  const selectClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)] bg-white text-slate-900';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {salon.logo_url && (
            <img src={salon.logo_url} alt={salon.name} className="h-11 w-11 rounded-lg object-contain border border-slate-100 bg-white" />
          )}
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{salon.name} — Upcoming Schedule</h1>
            <p className="text-sm text-slate-500 mt-0.5">Filter by date, service, or staff to find your bookings.</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
              <input type="date" min={today} value={fromDate} onChange={e => setFromDate(e.target.value)} className={selectClass + ' w-full'} />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
              <input type="date" min={fromDate || today} value={toDate} onChange={e => setToDate(e.target.value)} className={selectClass + ' w-full'} />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Service</label>
              <select value={serviceId} onChange={e => setServiceId(e.target.value)} className={selectClass + ' w-full'}>
                <option value="">All services</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Staff</label>
              <select value={staffId} onChange={e => setStaffId(e.target.value)} className={selectClass + ' w-full'}>
                <option value="">All staff</option>
                {staff.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-white border border-slate-100 animate-pulse" />)}
          </div>
        ) : grouped.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
            <p className="text-sm text-slate-500">No upcoming bookings in this range.</p>
          </div>
        ) : (
          grouped.map(([date, dayBookings]) => (
            <div key={date} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{formatDate(date)}</h2>
              <div className="space-y-2">
                {dayBookings.map((b, i) => (
                  <div key={i} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="font-medium text-slate-900 text-sm">{b.service_name}</p>
                      <p className="text-xs text-slate-500">{fmtTime(b.start_time)} – {fmtTime(b.end_time)}{b.staff_name ? ` · ${b.staff_name}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
