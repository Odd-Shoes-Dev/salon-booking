/**
 * How many hours from now (East Africa Time, regardless of server timezone)
 * until the given booking_date + start_time. Negative if already in the past.
 *
 * Plain `new Date(\`${date}T${time}\`)` is parsed in the SERVER's own local
 * timezone — on a UTC server that silently shifts the result by 3 hours,
 * which can move a cancellation/reschedule window's deadline by the same
 * amount. This computes the difference in EAT wall-clock minutes instead.
 */
export function hoursUntilEAT(bookingDate: string, startTime: string): number {
  const now = new Date();
  const localNow  = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  const localDate = localNow.toISOString().split('T')[0];
  const currentMin = localNow.getHours() * 60 + localNow.getMinutes();

  const [by, bm, bd] = bookingDate.split('-').map(Number);
  const [ly, lm, ld] = localDate.split('-').map(Number);
  const dayDiff = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ly, lm - 1, ld)) / 86400000);

  const [sh, sm] = startTime.split(':').map(Number);
  const bookingMin = dayDiff * 1440 + sh * 60 + sm;

  return (bookingMin - currentMin) / 60;
}
