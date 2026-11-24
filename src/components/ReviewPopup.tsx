'use client';

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'review-popup-dismissed';
const SHOW_DELAY_MS = 4000;

export default function ReviewPopup({ reviewUrl, salonName }: { reviewUrl?: string | null; salonName: string }) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!reviewUrl) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {}
    if (dismissed) return;

    const showTimer = setTimeout(() => setMounted(true), SHOW_DELAY_MS);
    return () => clearTimeout(showTimer);
  }, [reviewUrl]);

  useEffect(() => {
    if (!mounted) return;
    const enterTimer = setTimeout(() => setEntered(true), 20);
    return () => clearTimeout(enterTimer);
  }, [mounted]);

  if (!reviewUrl || !mounted) return null;

  const dismiss = () => {
    setEntered(false);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {}
    setTimeout(() => setMounted(false), 200);
  };

  return (
    <div
      className={`fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6 sm:max-w-sm sm:left-auto transition-all duration-200 ${
        entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-4 flex gap-3 items-start">
        <span className="text-2xl leading-none">⭐</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">Enjoyed {salonName}?</p>
          <p className="text-xs text-slate-500 mt-0.5">Let others know with a quick Google review.</p>
          <div className="flex gap-2 mt-3">
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="text-xs font-semibold text-white px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Leave a review
            </a>
            <button
              onClick={dismiss}
              className="text-xs font-medium text-slate-500 px-3 py-1.5 rounded-full hover:bg-slate-100 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-slate-400 hover:text-slate-600 text-sm leading-none shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
