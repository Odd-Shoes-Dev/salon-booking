import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSalonByDomain, getSalonBySubdomain } from '@/lib/tenants';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const h           = await headers();
  const customDomain = h.get('x-custom-domain') ?? '';
  const subdomain    = h.get('x-salon-subdomain') ?? 'posh';

  const salon = customDomain
    ? await getSalonByDomain(customDomain)
    : await getSalonBySubdomain(subdomain);
  if (!salon) notFound();

  return <LoginForm salon={salon} />;
}
