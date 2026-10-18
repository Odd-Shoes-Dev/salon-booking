'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import type { Salon } from '@/types';

type Step = 'phone' | 'code' | 'name';

interface Props {
  salon: Salon;
}

export default function LoginForm({ salon }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode]   = useState('');
  const [name, setName]   = useState('');
  const [loading, setLoading] = useState(false);

  const inputClass = 'w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand)] text-slate-900 bg-white';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-2';

  const requestCode = async () => {
    if (!phone.trim()) { toast.error('Enter your phone number.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to send code.'); return; }
      toast.success('Code sent! Check your phone.');
      setStep('code');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (withName?: string) => {
    if (!code.trim()) { toast.error('Enter the code we sent you.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim(), name: withName }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to verify code.'); return; }
      if (data.requiresName) {
        setStep('name');
        return;
      }
      toast.success('Logged in!');
      router.push('/account');
      router.refresh();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          {salon.logo_url && (
            <img src={salon.logo_url} alt={salon.name} className="h-11 w-11 rounded-lg object-contain border border-slate-100 bg-white" />
          )}
          <h1 className="text-xl font-semibold text-slate-900">{salon.name}</h1>
        </div>
      </div>

      <div className="max-w-sm mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          {step === 'phone' && (
            <>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Log In</h2>
              <p className="text-sm text-slate-500 mb-4">Enter your phone number — we&apos;ll text you a login code.</p>
              <label className={labelClass}>Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value.slice(0, 30))}
                placeholder="+256 700 000 000"
                autoComplete="tel"
                className={inputClass}
                onKeyDown={e => e.key === 'Enter' && requestCode()}
              />
              <button
                onClick={requestCode}
                disabled={loading}
                className="w-full mt-4 py-3 rounded-xl bg-[var(--brand)] text-white font-medium disabled:opacity-40"
              >
                {loading ? 'Sending...' : 'Send Code'}
              </button>
            </>
          )}

          {step === 'code' && (
            <>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Enter Code</h2>
              <p className="text-sm text-slate-500 mb-4">We sent a 6-digit code to {phone}.</p>
              <label className={labelClass}>Login Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className={inputClass + ' tracking-widest text-center text-lg'}
                onKeyDown={e => e.key === 'Enter' && verifyCode()}
              />
              <button
                onClick={() => verifyCode()}
                disabled={loading}
                className="w-full mt-4 py-3 rounded-xl bg-[var(--brand)] text-white font-medium disabled:opacity-40"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <button
                onClick={() => { setStep('phone'); setCode(''); }}
                className="w-full mt-2 text-sm text-slate-500 hover:text-slate-700"
              >← Use a different number</button>
            </>
          )}

          {step === 'name' && (
            <>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Welcome!</h2>
              <p className="text-sm text-slate-500 mb-4">Looks like you&apos;re new here. What&apos;s your name?</p>
              <label className={labelClass}>Full Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value.slice(0, 100))}
                placeholder="Enter your name"
                autoComplete="name"
                className={inputClass}
                onKeyDown={e => e.key === 'Enter' && verifyCode(name)}
              />
              <button
                onClick={() => verifyCode(name)}
                disabled={loading || !name.trim()}
                className="w-full mt-4 py-3 rounded-xl bg-[var(--brand)] text-white font-medium disabled:opacity-40"
              >
                {loading ? 'Creating account...' : 'Continue'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
