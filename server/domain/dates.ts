// Date helpers. All dates are ISO calendar dates (YYYY-MM-DD) handled in UTC,
// so a draw date never shifts with the server's time zone.

const DAY_MS = 86_400_000;

export function parseDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return new Date(parseDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** b - a, in whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Nov 23" */
export function shortDay(iso: string): string {
  const d = new Date(parseDay(iso));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Mon Nov 23" */
export function longDay(iso: string): string {
  const d = new Date(parseDay(iso));
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
