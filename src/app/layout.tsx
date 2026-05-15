import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Toaster } from 'react-hot-toast';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import type { Salon } from '@/types';
import '../styles/globals.css';

export const metadata: Metadata = { title: 'Book an Appointment' };

function hexToHsl(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return '217 91% 60%';
  let rv = parseInt(r[1], 16) / 255;
  let gv = parseInt(r[2], 16) / 255;
  let bv = parseInt(r[3], 16) / 255;
  const max = Math.max(rv, gv, bv), min = Math.min(rv, gv, bv);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rv: h = ((gv - bv) / d + (gv < bv ? 6 : 0)) / 6; break;
      case gv: h = ((bv - rv) / d + 2) / 6; break;
      case bv: h = ((rv - gv) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const customDomain = h.get('x-custom-domain');
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';

  let salon: Salon | null = null;
  if (customDomain) salon = await getSalonByDomain(customDomain);
  if (!salon)       salon = await getSalonBySubdomain(subdomain);

  const brandHsl = hexToHsl(salon?.theme_primary_color ?? '#2563EB');

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: `:root { --brand: hsl(${brandHsl}); }` }} />
      </head>
      <body>
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
