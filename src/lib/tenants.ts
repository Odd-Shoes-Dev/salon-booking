import { sql } from '@/lib/db';
import type { Salon } from '@/types';

export async function getSalonBySubdomain(subdomain: string): Promise<Salon | null> {
  try {
    const [salon] = await sql`
      SELECT * FROM salons WHERE subdomain = ${subdomain} AND is_active = true
    `;
    return (salon as Salon) ?? null;
  } catch {
    return null;
  }
}

export async function getSalonByDomain(domain: string): Promise<Salon | null> {
  try {
    const normalized = domain.replace(/^www\./, '');
    const [salon] = await sql`
      SELECT * FROM salons WHERE custom_domain = ${normalized} AND is_active = true
    `;
    return (salon as Salon) ?? null;
  } catch {
    return null;
  }
}
