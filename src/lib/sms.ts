/**
 * Minimal SMS helper — mirrors src/lib/sms in the main system, which picks a
 * provider via SMS_PROVIDER so the website stays in sync when the salon
 * switches providers there. All SMS are optional; if the active provider's
 * credentials aren't set, notifications are skipped silently.
 */

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 10) return `+256${digits.slice(1)}`;
  if (digits.length >= 9) return `+${digits}`;
  return trimmed;
}

function toGsm7Safe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
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

async function sendSms(to: string, text: string): Promise<void> {
  const provider = (process.env.SMS_PROVIDER ?? 'esms').toLowerCase();
  try {
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
  await sendSms(customerPhone, text);
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
  await sendSms(ownerPhone, text);
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
  await sendSms(customerPhone, text);
}

/** SMS with a one-time login code for the client portal */
export async function sendOtpSms(params: {
  customerPhone: string;
  code: string;
  salonName: string;
}): Promise<void> {
  const { customerPhone, code, salonName } = params;
  const text = `Your ${salonName} login code is ${code}. It expires in 10 minutes. Don't share this code with anyone.`;
  await sendSms(customerPhone, text);
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
  await sendSms(customerPhone, text);
}
