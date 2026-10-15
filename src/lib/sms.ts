/**
 * Minimal SMS helper — mirrors src/lib/sms in the main system.
 * Routes by recipient network: MTN numbers go through sms.ug (the only one of
 * our providers that can actually reach MTN); everything else uses whichever
 * provider SMS_PROVIDER selects (Africa's Talking or eSMS). All SMS are
 * optional; if a provider's credentials aren't set, sends through it are
 * skipped silently rather than breaking the booking flow.
 */

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 10) return `+256${digits.slice(1)}`;
  if (digits.length >= 9) return `+${digits}`;
  return trimmed;
}

// Uganda MTN prefixes (076/077/078/079). Anything else (070/071/072/073/074/075,
// or a non-Uganda number) falls back to the default provider — safe default,
// since that's the provider already known to work for non-MTN traffic.
function isMtnNumber(phone: string): boolean {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('256')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  const prefix = digits.slice(0, 2);
  return ['76', '77', '78', '79'].includes(prefix);
}

function toGsm7Safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\n\r]/g, '');
}

async function sendViaEsms(to: string, text: string): Promise<void> {
  const baseUrl = process.env.ESMS_BASE_URL ?? 'https://sms.esmsafrica.io';
  const apiKey  = process.env.ESMS_API_KEY  ?? '';
  if (!apiKey) return; // SMS not configured — skip silently

  await fetch(`${baseUrl}/api/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ to: normalizePhone(to), text: toGsm7Safe(text) }),
  });
}

async function sendViaAfricasTalking(to: string, text: string): Promise<void> {
  const apiKey   = process.env.AT_API_KEY   ?? '';
  const username = process.env.AT_USERNAME  ?? '';
  const senderId = process.env.AT_SENDER_ID ?? '';
  if (!apiKey || !username) return; // SMS not configured — skip silently

  const payload: Record<string, unknown> = {
    username,
    phoneNumbers: [normalizePhone(to)],
    message: text,
  };
  if (senderId) payload.senderId = senderId;

  const res = await fetch('https://api.africastalking.com/version1/messaging/bulk', {
    method: 'POST',
    headers: {
      apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.SMSMessageData?.Message ?? `AT send failed (HTTP ${res.status})`);
  }
}

// sms.ug — the only provider here that can reach MTN numbers. Note: their
// content filter rejects messages containing the words "code", "OTP", or
// "passcode" (keyword match, not semantic) — avoid those words in `text`.
async function sendViaSmsUg(to: string, text: string, title: string): Promise<void> {
  const apiKey = process.env.SMSUG_API_KEY ?? '';
  if (!apiKey) return; // SMS not configured — skip silently

  const res = await fetch('https://app.sms.ug/api/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ title, message: text, contacts: [normalizePhone(to)] }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message ?? `sms.ug send failed (HTTP ${res.status})`);
  }
}

async function sendSms(to: string, text: string, title = 'Salon Notification'): Promise<void> {
  try {
    if (isMtnNumber(to)) {
      await sendViaSmsUg(to, text, title);
      return;
    }
    const provider = (process.env.SMS_PROVIDER ?? 'esms').toLowerCase();
    if (provider === 'africastalking') {
      await sendViaAfricasTalking(to, text);
    } else {
      await sendViaEsms(to, text);
    }
  } catch {
    // SMS failure must never break the booking flow
  }
}

/** SMS to customer immediately after booking */
export async function sendBookingConfirmationSms(params: {
  customerPhone: string;
  customerName: string;
  bookingNumber: string;
  salonName: string;
  bookingDate: string;  // e.g. 'Friday, May 16 2026'
  startTime: string;    // e.g. '2:00 PM'
  serviceName: string;
  appUrl: string;
}): Promise<void> {
  const { customerPhone, customerName, bookingNumber, salonName, bookingDate, startTime, serviceName, appUrl } = params;
  const text =
    `Hi ${customerName}! Your booking at ${salonName} is received.\n` +
    `Ref: ${bookingNumber}\n` +
    `${serviceName} on ${bookingDate} at ${startTime}.\n` +
    `Check/manage: ${appUrl}/bookings/check\n` +
    `Save your Ref No. and the phone number you used!`;
  await sendSms(customerPhone, text, 'Booking Confirmation');
}

/** SMS to salon owner when a new self-booking arrives */
export async function sendNewBookingAlertSms(params: {
  ownerPhone: string;
  customerName: string;
  customerPhone: string;
  bookingNumber: string;
  bookingDate: string;
  startTime: string;
  serviceName: string;
}): Promise<void> {
  const { ownerPhone, customerName, customerPhone, bookingNumber, bookingDate, startTime, serviceName } = params;
  const text =
    `New self-booking!\n` +
    `Ref: ${bookingNumber}\n` +
    `Client: ${customerName} (${customerPhone})\n` +
    `${serviceName} - ${bookingDate} at ${startTime}.`;
  await sendSms(ownerPhone, text, 'New Booking Alert');
}

/** SMS to customer when salon confirms */
export async function sendBookingConfirmedSms(params: {
  customerPhone: string;
  customerName: string;
  bookingNumber: string;
  salonName: string;
  bookingDate: string;
  startTime: string;
}): Promise<void> {
  const { customerPhone, customerName, bookingNumber, salonName, bookingDate, startTime } = params;
  const text =
    `Hi ${customerName}! Your booking ${bookingNumber} at ${salonName} is CONFIRMED.\n` +
    `${bookingDate} at ${startTime}. See you then!`;
  await sendSms(customerPhone, text, 'Booking Confirmed');
}

/**
 * SMS with a one-time login PIN for the client portal.
 * Wording deliberately avoids "code"/"OTP"/"passcode" — sms.ug's content
 * filter blocks messages containing those words (keyword match, confirmed by
 * testing), regardless of whether the account is otherwise legitimate.
 */
export async function sendOtpSms(params: {
  customerPhone: string;
  code: string;
  salonName: string;
}): Promise<void> {
  const { customerPhone, code, salonName } = params;
  const text = `Your ${salonName} login PIN is ${code}. Expires in 10 minutes. Don't share this with anyone.`;
  await sendSms(customerPhone, text, 'Login Notice');
}

/** SMS to customer when booking is cancelled */
export async function sendCancellationSms(params: {
  customerPhone: string;
  customerName: string;
  bookingNumber: string;
  salonName: string;
}): Promise<void> {
  const { customerPhone, customerName, bookingNumber, salonName } = params;
  const text =
    `Hi ${customerName}, your booking ${bookingNumber} at ${salonName} has been cancelled. ` +
    `Call us to rebook anytime.`;
  await sendSms(customerPhone, text, 'Booking Cancelled');
}
