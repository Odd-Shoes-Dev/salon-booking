'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import type { Salon, Service } from '@/types';
import { CLIENT_PORTAL_VISIBLE } from '@/lib/featureFlags';

interface Worker   { id: string; name: string }
interface TimeSlot { startTime: string; endTime: string }

interface ServiceLine {
  service: Service;
  worker: Worker | null;
  slot: TimeSlot | null;
  slots: TimeSlot[];
  loadingSlots: boolean;
}

type Step = 1 | 2 | 3;

// Local calendar date, not UTC — avoids the day shifting near midnight
// depending on the browser's own timezone.
function getMinDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Saved progress so a reload, a flaky connection, or an accidental back
// button doesn't throw away everything the customer already picked.
const DRAFT_KEY = 'salon_booking_draft_v1';

interface StoredDraft {
  step: number;
  date: string;
  serviceIds: string[];
  lineChoices: { serviceId: string; workerId: string | null; workerName: string | null; slot: TimeSlot | null }[];
  name: string;
  phone: string;
  notes: string;
}

interface RestoredDraft {
  step: Step;
  date: string;
  selectedServices: Service[];
  lines: ServiceLine[];
  name: string;
  phone: string;
  notes: string;
}

function readDraft(initialServices: Service[]): RestoredDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as StoredDraft;
    const services = draft.serviceIds
      .map(id => initialServices.find(s => s.id === id))
      .filter((s): s is Service => !!s);
    if (services.length === 0) return null;

    // The stored date may now be in the past if the draft is a few days old.
    const minDate = getMinDate();
    const date = draft.date && draft.date >= minDate ? draft.date : '';

    const lines: ServiceLine[] = services.map(s => {
      const lc = draft.lineChoices.find(l => l.serviceId === s.id);
      return {
        service: s,
        worker: date && lc?.workerId ? { id: lc.workerId, name: lc.workerName ?? '' } : null,
        slot: date ? (lc?.slot ?? null) : null,
        slots: [],
        loadingSlots: false,
      };
    });

    const step: Step = !date
      ? (draft.step > 1 ? 2 : 1)
      : (draft.step >= 1 && draft.step <= 3 ? (draft.step as Step) : 1);

    return { step, date, selectedServices: services, lines, name: draft.name ?? '', phone: draft.phone ?? '', notes: draft.notes ?? '' };
  } catch {
    return null;
  }
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

function timesOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

interface Props {
  salon: Salon;
  initialServices: Service[];
}

export default function BookingForm({ salon, initialServices }: Props) {
  const router = useRouter();

  // Draft restoration (sessionStorage) happens in an effect below, never in
  // these initial values — reading sessionStorage during the initial render
  // would make the server's render (no window) disagree with the client's
  // hydration render (real sessionStorage), which is exactly the "branch on
  // typeof window" hydration-mismatch pitfall. Every state here starts at
  // the same plain default on both server and client.
  const [step, setStep] = useState<Step>(1);

  const [date, setDate] = useState('');
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  // Which service's staff/time picker is currently shown, when there's more
  // than one — guides the customer through them one at a time instead of
  // dumping every service's pickers onto the page at once.
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [closedDays, setClosedDays] = useState<number[]>([]);

  const [name,    setName]    = useState('');
  const [phone,   setPhone]   = useState('');
  const [notes,   setNotes]   = useState('');
  const [loggedIn, setLoggedIn] = useState(false);

  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [loading,        setLoading]        = useState(false);

  // If the guest is already logged in, pre-fill their details so they don't
  // have to retype them — the booking still links to their account either way.
  useEffect(() => {
    fetch('/api/account/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setName(d.name ?? '');
          setPhone(d.phone ?? '');
          setLoggedIn(true);
        }
      })
      .catch(() => {});
  }, []);

  // Which weekdays the salon is structurally closed on, so the calendar can
  // grey them out instead of letting the customer discover "no slots" only
  // after picking the date and a staff member.
  useEffect(() => {
    fetch('/api/workers/closed-days')
      .then(r => r.ok ? r.json() : null)
      .then(d => setClosedDays(Array.isArray(d?.closedDays) ? d.closedDays : []))
      .catch(() => {});
  }, []);

  // Restore saved progress — only after mount, so this never runs during
  // server rendering and can't disagree with what the server sent down.
  useEffect(() => {
    const restored = readDraft(initialServices);
    if (!restored) return;
    setStep(restored.step);
    setDate(restored.date);
    setSelectedServices(restored.selectedServices);
    setLines(restored.lines);
    // A faster-resolving logged-in-identity fetch (above) should win if it
    // beats this to setting name/phone — unlikely, but cheap to guard.
    setName(prev => prev || restored.name);
    setPhone(prev => prev || restored.phone);
    setNotes(prev => prev || restored.notes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save progress as the customer goes, so a reload or a dropped connection
  // doesn't throw away everything they already picked. Skips its very first
  // run so it can never race the restore effect above and overwrite a saved
  // draft with the pre-restore empty state.
  const skippedFirstSave = useRef(false);
  useEffect(() => {
    if (!skippedFirstSave.current) { skippedFirstSave.current = true; return; }
    if (selectedServices.length === 0) {
      sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    const toSave: StoredDraft = {
      step,
      date,
      serviceIds: selectedServices.map(s => s.id),
      lineChoices: lines.map(l => ({
        serviceId: l.service.id,
        workerId: l.worker?.id ?? null,
        workerName: l.worker?.name ?? null,
        slot: l.slot,
      })),
      name,
      phone,
      notes,
    };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(toSave)); } catch {}
  }, [step, date, selectedServices, lines, name, phone, notes]);

  // Service search / filter
  const [serviceSearch,  setServiceSearch]  = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  // Expands the floating cart bar into a removable list of what's selected.
  const [cartOpen, setCartOpen] = useState(false);

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

  const totalPrice    = useMemo(() => selectedServices.reduce((sum, s) => sum + Number(s.price), 0), [selectedServices]);
  const totalDuration = useMemo(() => selectedServices.reduce((sum, s) => sum + s.duration_minutes, 0), [selectedServices]);

  const toggleService = (s: Service) => {
    setSelectedServices(prev =>
      prev.some(p => p.id === s.id) ? prev.filter(p => p.id !== s.id) : [...prev, s]
    );
  };

  // Keep `lines` in sync with the selected-services cart, preserving existing
  // staff/time picks for services that are still selected.
  useEffect(() => {
    setLines(prev => selectedServices.map(s => {
      const existing = prev.find(l => l.service.id === s.id);
      return existing ?? { service: s, worker: null, slot: null, slots: [], loadingSlots: false };
    }));
  }, [selectedServices]);

  const setLineWorker = (idx: number, w: Worker | null) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, worker: w, slot: null } : l));
  };
  const setLineSlot = (idx: number, s: TimeSlot) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, slot: s } : l));
  };
  const onPickDate = (iso: string) => {
    setDate(iso);
    setLines(prev => prev.map(l => ({ ...l, worker: null, slot: null, slots: [] })));
    setActiveLineIdx(0);
  };

  // Fetch workers once per date (shared across all service lines)
  useEffect(() => {
    if (step !== 2 || !date) return;
    setLoadingWorkers(true);
    fetch(`/api/workers/available?date=${date}`)
      .then(r => r.json())
      .then(d => { setWorkers(Array.isArray(d) ? d : []); setLoadingWorkers(false); })
      .catch(() => setLoadingWorkers(false));
  }, [step, date]);

  // Fetch slots per line; re-fetch when date or that line's own staff changes
  const lineDeps = lines.map(l => `${l.service.id}:${l.worker?.id ?? ''}`).join(',');
  useEffect(() => {
    if (step !== 2 || !date || lines.length === 0) return;
    lines.forEach((line, idx) => {
      setLines(prev => prev.map((l, i) => i === idx ? { ...l, loadingSlots: true } : l));
      const url = `/api/slots/available?date=${date}&serviceDuration=${line.service.duration_minutes}${line.worker ? `&staffId=${line.worker.id}` : ''}`;
      fetch(url)
        .then(r => r.json())
        .then(d => {
          const fresh: TimeSlot[] = Array.isArray(d) ? d : [];
          setLines(prev => prev.map((l, i) => {
            if (i !== idx) return l;
            const keepSlot = l.slot && fresh.some(s => s.startTime === l.slot!.startTime);
            return { ...l, slots: fresh, loadingSlots: false, slot: keepSlot ? l.slot : null };
          }));
        })
        .catch(() => setLines(prev => prev.map((l, i) => i === idx ? { ...l, loadingSlots: false } : l)));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, date, lineDeps]);

  // If picking the same staff for two services on this date, the slot list
  // for one doesn't know about an in-progress (not-yet-submitted) pick for
  // the other — so if going back and changing an earlier service's time
  // creates an overlap with a later one already chosen, clear that later
  // pick instead of silently letting it through to a submit-time rejection.
  useEffect(() => {
    lines.forEach((l, i) => {
      if (!l.slot || !l.worker) return;
      // Only clear the later service of a conflicting pair — deterministic
      // regardless of which one the customer just edited.
      const conflictsWithEarlier = lines.some((other, j) =>
        j < i && other.worker?.id === l.worker!.id && other.slot && timesOverlap(l.slot!, other.slot)
      );
      if (conflictsWithEarlier) {
        toast.error(`${l.service.name}'s time now conflicts with another service using ${l.worker!.name} — please pick a new time.`);
        setLines(prev => prev.map((pl, pi) => pi === i ? { ...pl, slot: null } : pl));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const allLinesReady = lines.length > 0 && lines.every(l => l.slot);

  // Inline "this number is already a client — verify to continue" step
  const [needsVerification, setNeedsVerification] = useState(false);
  const [otpSent,    setOtpSent]    = useState(false);
  const [otpCode,    setOtpCode]    = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  const submitBooking = useCallback(async (opts?: { skipVerification?: boolean }) => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: name.trim(),
          guest_phone: phone.trim(),
          booking_date: date,
          notes: notes.trim() || null,
          skipVerification: opts?.skipVerification,
          services: lines.map(l => ({
            service_id: l.service.id,
            staff_id: l.worker?.id ?? null,
            start_time: l.slot!.startTime,
          })),
        }),
      });
      const data = await res.json();
      if (data.requiresVerification) {
        setNeedsVerification(true);
        setLoading(false);
        return;
      }
      if (!res.ok) { toast.error(data.error ?? 'Failed to create booking.'); setLoading(false); return; }
      const numbers: string[] = data.bookingNumbers ?? (data.bookingNumber ? [data.bookingNumber] : []);
      if (numbers.length === 0) { toast.error('Booking created but no reference was returned.'); setLoading(false); return; }
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      const [first, ...rest] = numbers;
      const qs = rest.length > 0 ? `?also=${rest.join(',')}` : '';
      router.push(`/booking/confirmation/${first}${qs}`);
    } catch {
      toast.error('Network error. Please try again.');
      setLoading(false);
    }
  }, [date, lines, name, phone, notes, router]);

  const handleSubmit = useCallback(() => {
    if (!date || !allLinesReady || !name.trim() || !phone.trim()) {
      toast.error('Please fill in all required fields.');
      return;
    }
    submitBooking();
  }, [date, allLinesReady, name, phone, submitBooking]);

  const sendVerificationCode = async () => {
    setOtpLoading(true);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to send code.'); return; }
      setOtpSent(true);
      toast.success('Code sent! Check your phone.');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyAndBook = async () => {
    if (!otpCode.trim()) { toast.error('Enter the code we sent you.'); return; }
    setOtpLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.requiresName) { toast.error(data.error ?? 'Verification failed. Please try again.'); return; }
      setNeedsVerification(false);
      setOtpSent(false);
      setOtpCode('');
      setLoggedIn(true);
      await submitBooking();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const inputClass = 'w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] text-slate-900 bg-white';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-2';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header — data already available from server, renders instantly */}
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
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
              <Link href="/bookings/check" className="block text-sm text-[var(--brand)] font-medium mt-0.5">
                Check Booking
              </Link>
            </div>
          </div>
          {CLIENT_PORTAL_VISIBLE && (
            <Link
              href={loggedIn ? '/account' : '/account/login'}
              className="text-sm text-[var(--brand)] font-medium shrink-0"
            >
              {loggedIn ? 'My Account' : 'Log In'}
            </Link>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-slate-100 px-4 py-3">
        <div className="max-w-lg mx-auto flex gap-2 text-xs font-medium">
          {(['Services', 'Schedule', 'Details'] as const).map((label, i) => {
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
                <span>{label}</span>
                {i < 2 && <span className="text-slate-200 ml-1">›</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`max-w-lg mx-auto px-4 py-6 ${step === 1 && selectedServices.length > 0 ? (cartOpen ? 'pb-96' : 'pb-28') : ''}`}>

        {/* ── Step 1: Services (multi-select cart) ─────────────────────────── */}
        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Choose Services</h2>
            <p className="text-sm text-slate-500 mb-4">Select the services you'd like — you can choose more than one.</p>

            <p className="text-xs text-slate-500 mb-4">
              Please note that the prices listed for our services are for plain colours only. Prices may vary depending on your preferred design, nail art, and level of detail. Kindly confirm your design of choice with us for an accurate price quote. 💅✨ Thank you for choosing us! ❤️
            </p>

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
                      selected={selectedServices.some(p => p.id === s.id)}
                      showCategory={!activeCategory}
                      onClick={() => toggleService(s)}
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
                          selected={selectedServices.some(p => p.id === s.id)}
                          showCategory={false}
                          onClick={() => toggleService(s)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Schedule (Date + per-service Staff/Time) ─────────────── */}
        {step === 2 && lines.length > 0 && (
          <div className="space-y-4">

            {/* Services summary */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-500">Selected services</p>
                <button
                  onClick={() => setStep(1)}
                  className="text-xs text-[var(--brand)] hover:underline"
                >Change</button>
              </div>
              <div className="space-y-1.5">
                {selectedServices.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    <span className="text-slate-500">{s.duration_minutes} min · UGX {Number(s.price).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-2 mt-2 border-t border-slate-100 text-sm font-semibold">
                <span className="text-slate-700">Total</span>
                <span className="text-[var(--brand)]">UGX {totalPrice.toLocaleString()}</span>
              </div>
            </div>

            {/* Inline calendar */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Pick a Date</h2>
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
                  const closed   = closedDays.includes(new Date(iso + 'T12:00:00').getDay());
                  const disabled = iso < minDate || closed;
                  const selected = iso === date;
                  return (
                    <button
                      key={iso}
                      disabled={disabled}
                      onClick={() => onPickDate(iso)}
                      title={closed && iso >= minDate ? 'Closed' : undefined}
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
              {date ? (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-center text-slate-500">{formatDate(date)}</p>
              ) : closedDays.length > 0 ? (
                <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-center text-slate-400">Greyed-out days are closed.</p>
              ) : null}
            </div>

            {/* Per-service progress — only shown when there's more than one
                service, so a single-service booking looks exactly as before. */}
            {date && lines.length > 1 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                <p className="text-xs text-slate-500 mb-3 text-center">
                  Choose a staff member and time for each service, one at a time.
                </p>
                <div className="flex items-center justify-center gap-2">
                  {lines.map((l, i) => (
                    <button
                      key={l.service.id}
                      onClick={() => setActiveLineIdx(i)}
                      title={l.service.name}
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                        ${i === activeLineIdx
                          ? 'bg-[var(--brand)] text-white'
                          : l.slot ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {l.slot ? '✓' : i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Staff + time picker — shows only the active service when
                there's more than one, guiding the customer through them one
                at a time instead of dumping every picker on the page. */}
            {date && lines.length > 0 && (() => {
              const idx  = lines.length > 1 ? activeLineIdx : 0;
              const line = lines[idx];
              // Hide times that would double-book the same staff member
              // against an earlier service already scheduled in this booking
              // — the backend blocks it anyway, this just avoids offering it.
              const visibleSlots = line.worker
                ? line.slots.filter(s => !lines.some((other, j) =>
                    j < idx && other.worker?.id === line.worker!.id && other.slot && timesOverlap(s, other.slot)
                  ))
                : line.slots;
              return (
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                  <h2 className="text-sm font-semibold text-slate-700 mb-1">
                    {lines.length > 1 ? `Service ${idx + 1} of ${lines.length}: ${line.service.name}` : line.service.name}
                  </h2>
                  <p className="text-xs text-slate-400 mb-4">{line.service.duration_minutes} min · UGX {Number(line.service.price).toLocaleString()}</p>

                  <p className="text-xs font-medium text-slate-500 mb-1">Staff</p>
                  <p className="text-xs text-slate-400 mb-1">Pick someone specific, or choose &quot;Any Staff&quot; and we&apos;ll assign whoever&apos;s free.</p>
                  <p className="text-xs text-slate-400 mb-2">Don&apos;t see someone you were expecting? They may not be working that day — try a different date.</p>
                  {loadingWorkers ? (
                    <div className="flex gap-2 flex-wrap mb-4">
                      {[1, 2, 3].map(i => <div key={i} className="h-9 w-24 rounded-lg bg-slate-100 animate-pulse" />)}
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap mb-4">
                      <button
                        onClick={() => setLineWorker(idx, null)}
                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors
                          ${line.worker === null ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                      >Any Staff</button>
                      {workers.map(w => (
                        <button
                          key={w.id}
                          onClick={() => setLineWorker(idx, w)}
                          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors
                            ${line.worker?.id === w.id ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                        >{w.name}</button>
                      ))}
                      {workers.length === 0 && (
                        <p className="text-sm text-slate-500">No staff available on this day.</p>
                      )}
                    </div>
                  )}

                  <p className="text-xs font-medium text-slate-500 mb-2">
                    Time{line.worker && <span className="font-normal text-slate-400"> · {line.worker.name}</span>}
                  </p>
                  {line.loadingSlots ? (
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}
                    </div>
                  ) : visibleSlots.length === 0 ? (
                    <p className="text-sm text-slate-500 py-1">
                      {line.slots.length > 0 && line.worker
                        ? `${line.worker.name} is already booked for another service in this visit at every remaining time. Try a different staff member or date.`
                        : `No times available${line.worker ? ` for ${line.worker.name}` : ''} on this date. Try a different date or staff member.`}
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {visibleSlots.map(s => (
                        <button
                          key={s.startTime}
                          onClick={() => setLineSlot(idx, s)}
                          className={`py-2.5 rounded-lg border text-sm font-medium transition-colors
                            ${line.slot?.startTime === s.startTime
                              ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}
                        >{fmtTime(s.startTime)}</button>
                      ))}
                    </div>
                  )}

                  {lines.length > 1 && (
                    <div className="flex gap-3 mt-4 pt-4 border-t border-slate-100">
                      {idx > 0 && (
                        <button
                          onClick={() => setActiveLineIdx(idx - 1)}
                          className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium"
                        >‹ Previous</button>
                      )}
                      {idx < lines.length - 1 && (
                        <button
                          onClick={() => setActiveLineIdx(idx + 1)}
                          disabled={!line.slot}
                          className="flex-1 py-2.5 rounded-lg bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40"
                        >Next Service ›</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Advance once date + every service has a time */}
            {date && allLinesReady && (
              <button
                onClick={() => setStep(3)}
                className="w-full py-3 rounded-xl bg-[var(--brand)] text-white font-medium"
              >
                Continue to Details →
              </button>
            )}

            <button
              onClick={() => setStep(1)}
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
              <div className="flex justify-between text-sm mb-3">
                <span className="text-slate-500">Date</span>
                <span className="font-medium text-slate-900">{date ? formatDate(date) : '—'}</span>
              </div>
              <div className="space-y-3">
                {lines.map(l => (
                  <div key={l.service.id} className="flex justify-between text-sm border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                    <div>
                      <p className="font-medium text-slate-900">{l.service.name}</p>
                      <p className="text-xs text-slate-500">
                        {l.slot ? fmtTime(l.slot.startTime) : '—'}{l.worker ? ` · ${l.worker.name}` : ''}
                      </p>
                    </div>
                    <span className="font-medium text-slate-900">UGX {Number(l.service.price).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-3 mt-3 border-t border-slate-100">
                <span className="text-sm font-semibold text-slate-700">Total</span>
                <span className="text-sm font-bold text-[var(--brand)]">UGX {totalPrice.toLocaleString()}</span>
              </div>
            </div>

            {/* Contact details */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Your Details</h2>
              <div className="space-y-4">
                {loggedIn ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-100 text-sm text-slate-700">
                    <span>👤</span>
                    <span>Booking as <strong className="font-semibold">{name}</strong> · {phone}</span>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
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

            {needsVerification ? (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-3">
                <p className="text-sm font-medium text-slate-900">This number is already registered</p>
                <p className="text-xs text-slate-500">
                  Verify it&apos;s you with a one-time code so this booking shows up correctly in your account —
                  or continue without verifying and we&apos;ll book it as a guest.
                </p>
                {!otpSent ? (
                  <button
                    onClick={sendVerificationCode}
                    disabled={otpLoading}
                    className="w-full py-2.5 rounded-lg bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40"
                  >
                    {otpLoading ? 'Sending...' : 'Send Verification Code'}
                  </button>
                ) : (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otpCode}
                      onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className={inputClass + ' tracking-widest text-center'}
                      onKeyDown={e => e.key === 'Enter' && verifyAndBook()}
                    />
                    <button
                      onClick={verifyAndBook}
                      disabled={otpLoading}
                      className="w-full py-2.5 rounded-lg bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40"
                    >
                      {otpLoading ? 'Verifying...' : 'Verify & Book'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => submitBooking({ skipVerification: true })}
                  disabled={loading || otpLoading}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40"
                >
                  Continue as guest without verifying
                </button>
              </div>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || !name.trim() || !phone.trim()}
                className="w-full py-3 rounded-xl bg-[var(--brand)] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading
                  ? <><span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Booking...</>
                  : `Confirm Booking${lines.length > 1 ? `s (${lines.length})` : ''}`}
              </button>
            )}
            <button onClick={() => setStep(2)} className="text-sm text-slate-500 hover:text-slate-700">
              ← Back to Schedule
            </button>
          </div>
        )}
      </div>

      {/* Floating cart bar — step 1 only, once at least one service is picked.
          Tapping the summary expands it into the actual list, so reviewing
          or removing a pick doesn't mean hunting back through the grid. */}
      {step === 1 && selectedServices.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-10">
          <div className="max-w-lg mx-auto">
            {cartOpen && (
              <div className="max-h-56 overflow-y-auto px-4 pt-2 divide-y divide-slate-100 border-b border-slate-100">
                {selectedServices.map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.duration_minutes} min · UGX {Number(s.price).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => toggleService(s)}
                      aria-label={`Remove ${s.name}`}
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <button onClick={() => setCartOpen(o => !o)} className="flex items-center gap-1.5 text-left">
                <div>
                  <p className="text-sm font-semibold text-slate-900 flex items-center gap-1">
                    {selectedServices.length} service{selectedServices.length > 1 ? 's' : ''} selected
                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${cartOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </p>
                  <p className="text-xs text-slate-500">{totalDuration} min · UGX {totalPrice.toLocaleString()}</p>
                </div>
              </button>
              <button
                onClick={() => { setCartOpen(false); setStep(2); }}
                className="px-6 py-2.5 rounded-lg bg-[var(--brand)] text-white text-sm font-medium shrink-0"
              >Continue →</button>
            </div>
          </div>
        </div>
      )}
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
      className={`relative text-left p-4 rounded-xl border transition-colors flex flex-col gap-1 w-full
        ${selected
          ? 'border-[var(--brand)] bg-blue-50'
          : 'border-slate-200 hover:border-slate-300 bg-white'}`}
    >
      {selected && (
        <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[var(--brand)] text-white text-xs flex items-center justify-center">✓</span>
      )}
      {showCategory && service.category_name && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{service.category_name}</span>
      )}
      <span className="font-semibold text-slate-900 text-sm leading-snug pr-5">{service.name}</span>
      {service.description && (
        <span className="text-xs text-slate-500 leading-snug line-clamp-2">{service.description}</span>
      )}
      <span className="text-xs text-slate-400">{service.duration_minutes} min</span>
      <span className="text-sm font-bold text-[var(--brand)] mt-0.5">UGX {Number(service.price).toLocaleString()}</span>
    </button>
  );
}
