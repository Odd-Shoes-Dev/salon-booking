# Domain Routing

Both the **Booking app** (this app — customer-facing) and the **System app** (management dashboard) follow the same domain convention. The root domain is controlled by a single environment variable so it can be changed without touching any code.

---

## Environment Variable

```env
# Set in salon-booking/.env.local
NEXT_PUBLIC_ROOT_DOMAIN=blueoxgroup.eu
```

Change this one value in both apps to switch providers (e.g. `blueoxsalon.com`).  
The middleware falls back to `blueoxgroup.eu` if the variable is not set.

---

## URL Convention

### Salons using the default domain

| URL | App served | Example |
|---|---|---|
| `{slug}.ROOT_DOMAIN` | Booking app | `posh.blueoxgroup.eu` |
| `system-{slug}.ROOT_DOMAIN` | System app | `system-posh.blueoxgroup.eu` |

### Salons with a custom domain

| URL | App served | Example |
|---|---|---|
| `customdomain.com` | Booking app | `poshnails.com` |
| `system.customdomain.com` | System app | `system.poshnails.com` |

> `www.` is stripped from all hostnames before any matching takes place.

---

## Safety Redirects (301)

The booking app middleware detects when a system-side URL arrives and redirects to the matching booking URL:

| Scenario | Action |
|---|---|
| Receives `system-posh.blueoxgroup.eu` | → 301 to `posh.blueoxgroup.eu` |
| Receives `system.poshnails.com` | → 301 to `poshnails.com` |

---

## Local Development & Vercel Previews

Defaults to the `posh` salon when running on `localhost` or a `.vercel.app` preview URL.  
No redirects are triggered in these environments.

---

## How the Middleware Works

`src/middleware.ts` resolves the salon from the hostname and forwards two headers:

| Header | Value |
|---|---|
| `x-salon-subdomain` | slug (e.g. `posh`) or empty string for root domain |
| `x-custom-domain` | full custom hostname (e.g. `poshnails.com`) or empty string |

Detection order:

```
hostname
  └─ isLocalDev / isVercelPrev  → subdomain = 'posh' (no redirect)
  └─ isCustomDomain
       └─ starts with "system."  → redirect to hostname without prefix (301)
       └─ no prefix              → customDomain = hostname ✓
  └─ isOwnedDomain ({slug}.ROOT_DOMAIN)
       └─ starts with "system-"  → redirect to {slug}.ROOT_DOMAIN (301)
       └─ bare root domain       → no salon context, pass through
       └─ plain slug             → subdomain = slug ✓
```

---

## DNS Setup Checklist (Production)

For a salon with slug `posh` and custom domain `poshnails.com`:

```
# Default domain  — point to this Booking app deployment
posh.blueoxgroup.eu              CNAME   booking-app.vercel.app

# Custom domain   — point to this Booking app deployment
poshnails.com / www.poshnails.com  CNAME  booking-app.vercel.app
```

The matching system-side entries are configured in the System app's DNS.

---

## Related Files

| File | Description |
|---|---|
| `src/middleware.ts` | This app's domain router |
| `.env.local.example` | Env template (includes `NEXT_PUBLIC_ROOT_DOMAIN`) |
| `../docs/domain-routing.md` | Full cross-app routing reference (system app docs) |
