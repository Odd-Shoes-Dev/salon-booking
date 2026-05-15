'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Salon, Service } from '@/types';

interface Worker   { id: string; name: string }
interface TimeSlot { startTime: string; endTime: string }

type Step = 1 | 2 | 3;

function getMinDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

interface Props {
  salon: Salon;
  initialServices: Service[];
}

export default function BookingForm({ salon, initialServices }: Props) {
  const router = useRouter();

  const [step, setStep] = useState<Step>(1);

  const [date,    setDate]    = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [worker,  setWorker]  = useState<Worker | null>(null);
  const [slots,   setSlots]   = useState<TimeSlot[]>([]);
  const [slot,    setSlot]    = useState<TimeSlot | null>(null);

  const [name,    setName]    = useState('');
  const [phone,   setPhone]   = useState('');
  const [notes,   setNotes]   = useState('');

  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [loadingSlots,   setLoadingSlots]   = useState(false);
  const [loading,        setLoading]        = useState(false);

  // Service search / filter
  const [serviceSearch,  setServiceSearch]  = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  // Inline calendar navigation
  const [calYear,  setCalYear]  = useState(() => new Date(getMinDate() + 'T12:00:00').getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date(getMinDate() + 'T12:00:00').getMonth());

  // Unique categories derived from pre-loaded services
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const cats: string[] = [];
    for (const s of initialServices) {
      if (s.category_name && !seen.has(s.category_name)) {
        seen.add(s.category_name);
        cats.push(s.category_name);
      }
    }
    return cats;
  }, [initialServices]);

  // Services grouped by category (category order preserved from DB)
  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of initialServices) {
      const cat = s.category_name ?? 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    }
    return map;
  }, [initialServices]);

  // Flat filtered list — null when no filter active means show grouped view
  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim() && !activeCategory) return null;
    let r = initialServices;
    if (activeCategory) r = r.filter(s => s.category_name === activeCategory);
    if (serviceSearch.trim()) {
      const q = serviceSearch.trim().toLowerCase();
      r = r.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [initialServices, activeCategory, serviceSearch]);

  // Calendar grid: null = padding cell, string = ISO date
  const calDays = useMemo(() => {
    const firstDay    = new Date(calYear, calMonth, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(`${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return days;
  }, [calYear, calMonth]);

  const minDate      = getMinDate();
  const minDateYear  = Number(minDate.slice(0, 4));
  const minDateMonth = Number(minDate.slice(5, 7)) - 1; // 0-indexed

  // Fetch workers when step 2 and a date is chosen
  useEffect(() => {
    if (step !== 2 || !date) return;
    setLoadingWorkers(true);
    fetch(`/api/workers/available?date=${date}`)
      .then(r => r.json())
      .then(d => { setWorkers(Array.isArray(d) ? d : []); setLoadingWorkers(false); })
      .catch(() => setLoadingWorkers(false));
  }, [step, date]);

  // Fetch slots when step 2, date and service set; re-fetch when worker changes
  useEffect(() => {
    if (step !== 2 || !service || !date) return;
    setLoadingSlots(true);
    const url = `/api/slots/available?date=${date}&serviceDuration=${service.duration_minutes}${worker ? `&staffId=${worker.id}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setSlots(Array.isArray(d) ? d : []); setLoadingSlots(false); })
      .catch(() => setLoadingSlots(false));
  }, [step, date, service, worker]);

  const handleSubmit = useCallback(async () => {
    if (!date || !service || !slot || !name.trim() || !phone.trim()) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: name.trim(),
          guest_phone: phone.trim(),
          service_id: service.id,
          staff_id: worker?.id ?? null,
          booking_date: date,
          start_time: slot.startTime,
          end_time: slot.endTime,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to create booking.'); setLoading(false); return; }
      router.push(`/booking/confirmation/${data.bookingNumber}`);
    } catch {
      toast.error('Network error. Please try again.');
      setLoading(false);
    }
  }, [date, service, worker, slot, name, phone, notes, router]);

  const inputClass = 'w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] text-slate-900 bg-white';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-2';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header — data already available from server, renders instantly */}
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {salon.logo_url && (
            <img
              src={salon.logo_url}
              alt={salon.name}
              className="h-11 w-11 rounded-lg object-contain border border-slate-100 bg-white"
            />
          )}
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{salon.name}</h1>
            {salon.phone && (
              <p className="text-sm text-slate-500 mt-0.5">
                Need help? Call <a href={`tel:${salon.phone}`} className="text-[var(--brand)]">{salon.phone}</a>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-slate-100 px-4 py-3">
        <div className="max-w-lg mx-auto flex gap-2 text-xs font-medium">
          {(['Service', 'Schedule', 'Details'] as const).map((label, i) => {
            const s = (i + 1) as Step;
            return (
              <div
                key={label}
                className={`flex items-center gap-1 ${s === step ? 'text-[var(--brand)]' : s < step ? 'text-slate-400' : 'text-slate-300'}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${s === step ? 'bg-[var(--brand)] text-white' : s < step ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'}`}>
                  {s < step ? '✓' : s}
                </span>
                <span className="hidden sm:inline">{label}</span>
                {i < 2 && <span className="text-slate-200 ml-1">›</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">

        {/* ── Step 1: Service ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Choose a Service</h2>
            <p className="text-sm text-slate-500 mb-4">What would you like to have done?</p>

            {/* Search */}
            <div className="relative mb-4">
              <input
                type="text"
                value={serviceSearch}
                onChange={e => setServiceSearch(e.target.value)}
                placeholder="Search services..."
                className="w-full px-4 py-2.5 pl-9 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)] bg-white text-slate-900"
              />
              <svg className="absolute left-3 top-3 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              {serviceSearch && (
                <button
                  onClick={() => setServiceSearch('')}
                  className="absolute right-3 top-2 text-slate-400 hover:text-slate-700 text-xl leading-none"
                  aria-label="Clear search"
                >×</button>
              )}
            </div>

            {/* Category pills — hidden when searching */}
            {categories.length > 1 && !serviceSearch && (
              <div className="flex gap-2 flex-wrap mb-4">
                <button
                  onClick={() => setActiveCategory('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                    ${!activeCategory ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                >All</button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? '' : cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                      ${activeCategory === cat ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                  >{cat}</button>
                ))}
              </div>
            )}

            {/* Flat grid when searching/filtering, grouped grid otherwise */}
            {filteredServices !== null ? (
              filteredServices.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-6">No services match your search.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredServices.map(s => (
                    <ServiceCard
                      key={s.id}
                      service={s}
                      selected={service?.id === s.id}
                      showCategory={!activeCategory}
                      onClick={() => { setService(s); setStep(2); }}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-6">
                {[...grouped.entries()].map(([cat, svcs]) => (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{cat}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {svcs.map(s => (
                        <ServiceCard
                          key={s.id}
                          service={s}
                          selected={service?.id === s.id}
                          showCategory={false}
                          onClick={() => { setService(s); setStep(2); }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Schedule (Date + Staff + Time on one page) ──────────────── */}
        {step === 2 && service && (
          <div className="space-y-4">

            {/* Service summary chip */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Selected service</p>
                <p className="font-semibold text-slate-900">{service.name}</p>
                <p className="text-xs text-slate-500">{service.duration_minutes} min · UGX {Number(service.price).toLocaleString()}</p>
              </div>
              <button
                onClick={() => { setService(null); setDate(''); setWorker(null); setSlot(null); setStep(1); }}
                className="text-xs text-[var(--brand)] hover:underline ml-4 shrink-0"
              >Change</button>
            </div>

            {/* Inline calendar */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Pick a Date</h2>
              <p className="text-xs text-slate-400 mb-4">Bookings require at least 48 hours notice.</p>
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                    else setCalMonth(m => m - 1);
                  }}
                  disabled={calYear < minDateYear || (calYear === minDateYear && calMonth <= minDateMonth)}
                  className="w-9 h-9 rounded-lg flex items-center justify-center border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-xl leading-none"
                >‹</button>
                <span className="font-semibold text-slate-800 text-sm select-none">
                  {new Date(calYear, calMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  onClick={() => {
                    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
                    else setCalMonth(m => m + 1);
                  }}
                  className="w-9 h-9 rounded-lg flex items-center justify-center border border-slate-200 text-slate-600 hover:bg-slate-50 text-xl leading-none"
                >›</button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="text-center text-xs font-medium text-slate-400 py-1 select-none">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {calDays.map((iso, idx) => {
                  if (!iso) return <div key={`pad-${idx}`} />;
                  const disabled = iso < minDate;
                  const selected = iso === date;
                  return (
                    <button
                      key={iso}
                      disabled={disabled}
                      onClick={() => { setDate(iso); setWorker(null); setSlot(null); }}
                      className={`mx-auto w-9 h-9 rounded-full text-sm flex items-center justify-center transition-colors select-none
                        ${selected
                          ? 'bg-[var(--brand)] text-white font-semibold'
                          : disabled
                            ? 'text-slate-200 cursor-not-allowed'
                            : 'text-slate-700 hover:bg-slate-100 font-medium'}`}
                    >
                      {Number(iso.slice(-2))}
                    </button>
                  );
                })}
              </div>
              {date && (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-center text-slate-500">{formatDate(date)}</p>
              )}
            </div>

            {/* Staff — appears once a date is chosen */}
            {date && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-4">Choose a Staff Member</h2>
                {loadingWorkers ? (
                  <div className="flex gap-2 flex-wrap">
                    {[1, 2, 3].map(i => <div key={i} className="h-9 w-24 rounded-lg bg-slate-100 animate-pulse" />)}
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => { setWorker(null); setSlot(null); }}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors
                        ${worker === null ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                    >Any Staff</button>
                    {workers.map(w => (
                      <button
                        key={w.id}
                        onClick={() => { setWorker(w); setSlot(null); }}
                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors
                          ${worker?.id === w.id ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                      >{w.name}</button>
                    ))}
                    {workers.length === 0 && (
                      <p className="text-sm text-slate-500">No staff available on this day.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Time slots — appear once a date is chosen, re-fetch when staff changes */}
            {date && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-1">
                  Available Times
                  {worker && <span className="font-normal text-slate-500"> · {worker.name}</span>}
                </h2>
                <p className="text-xs text-slate-400 mb-4">Tap a time to select it</p>
                {loadingSlots ? (
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-slate-500 py-1">
                    No times available{worker ? ` for ${worker.name}` : ''} on this date. Try a different date or staff member.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map(s => (
                      <button
                        key={s.startTime}
                        onClick={() => setSlot(s)}
                        className={`py-2.5 rounded-lg border text-sm font-medium transition-colors
                          ${slot?.startTime === s.startTime
                            ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                            : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                      >{fmtTime(s.startTime)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Advance once date + time are both chosen */}
            {date && slot && (
              <button
                onClick={() => setStep(3)}
                className="w-full py-3 rounded-xl bg-[var(--brand)] text-white font-medium"
              >
                Continue to Details →
              </button>
            )}

            <button
              onClick={() => { setDate(''); setWorker(null); setSlot(null); setStep(1); }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >← Back to Services</button>
          </div>
        )}

        {/* ── Step 3: Details + Submit ──────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">

            {/* Booking summary */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Booking Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Service</span>
                  <span className="font-medium text-slate-900">{service?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date</span>
                  <span className="font-medium text-slate-900">{date ? formatDate(date) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Time</span>
                  <span className="font-medium text-slate-900">{slot ? fmtTime(slot.startTime) : '—'}</span>
                </div>
                {worker && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Staff</span>
                    <span className="font-medium text-slate-900">{worker.name}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-100">
                  <span className="text-slate-500">Price</span>
                  <span className="font-semibold text-[var(--brand)]">UGX {service ? Number(service.price).toLocaleString() : '—'}</span>
                </div>
              </div>
            </div>

            {/* Contact details */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Your Details</h2>
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Full Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value.slice(0, 100))}
                    placeholder="Enter your name"
                    autoComplete="name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Phone Number *</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value.slice(0, 30))}
                    placeholder="+256 700 000 000"
                    autoComplete="tel"
                    className={inputClass}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Save this number — you&apos;ll need it to check or cancel your booking.
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value.slice(0, 500))}
                    placeholder="Any special requests?"
                    rows={2}
                    className={inputClass + ' resize-none'}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !name.trim() || !phone.trim()}
              className="w-full py-3 rounded-xl bg-[var(--brand)] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading
                ? <><span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Booking...</>
                : 'Confirm Booking'}
            </button>
            <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to Schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Service card ──────────────────────────────────────────────────────────
function ServiceCard({
  service, selected, showCategory, onClick,
}: {
  service: Service;
  selected: boolean;
  showCategory: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-colors flex flex-col gap-1 w-full
        ${selected
          ? 'border-[var(--brand)] bg-blue-50'
          : 'border-slate-200 hover:border-slate-300 bg-white'}`}
    >
      {showCategory && service.category_name && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{service.category_name}</span>
      )}
      <span className="font-semibold text-slate-900 text-sm leading-snug">{service.name}</span>
      <span className="text-xs text-slate-400">{service.duration_minutes} min</span>
      <span className="text-sm font-bold text-[var(--brand)] mt-0.5">UGX {Number(service.price).toLocaleString()}</span>
    </button>
  );
}
