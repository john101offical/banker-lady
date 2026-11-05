import type { Circle, Member, Snapshot } from '../../shared/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const dayMs = 86_400_000;

export function parseDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return new Date(parseDay(iso).getTime() + days * dayMs).toISOString().slice(0, 10);
}

export function shortDay(iso: string): string {
  const d = parseDay(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function longDay(iso: string): string {
  const d = parseDay(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function weekDate(circle: Circle, week: number): string {
  return addDays(circle.startDate, (week - 1) * circle.frequencyDays);
}

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function memberMap(snap: Snapshot): Map<string, Member> {
  return new Map(snap.members.map((m) => [m.id, m]));
}

export function initials(name: string): string {
  return name
    .replace(/^(Miss|Mr|Mrs|Ms)\.? /, '')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Builds a local-time Date for Bryntum from an ISO day, so bars sit on the right calendar day. */
export function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
