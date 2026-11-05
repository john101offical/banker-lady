// Turns what the host wrote or typed into a circle draft the solver can use.
// Everything here distrusts its input: it comes from a form or from a model.
import type { CircleDraft, DraftMember, LanguageCode } from '../../shared/types.js';
import { addDays, parseDay } from './dates.js';

export const MIN_MEMBERS = 2;
/** The book stays readable up to here. */
export const MAX_MEMBERS = 12;
const MAX_HAND = 10_000;
const LANGUAGES: LanguageCode[] = ['en', 'jm', 'es', 'ht'];

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function isoDate(value: unknown): string | null {
  const s = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const parsed = parseDay(s);
  // Rejects dates like 2026-02-31, which Date would quietly roll forward.
  return Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== s ? null : s;
}

/** The first Monday after `today`: partner draws fall on Mondays. */
export function nextMonday(today: string): string {
  const day = new Date(parseDay(today)).getUTCDay();
  return addDays(today, ((8 - day) % 7) || 7);
}

function callNameOf(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** Tidies a draft and lists whatever stops it being used. Never throws. */
export function cleanDraft(raw: unknown, today: string): { draft: CircleDraft; problems: string[] } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];

  const seen = new Set<string>();
  const members: DraftMember[] = (Array.isArray(input.members) ? input.members : [])
    .map((m) => (m && typeof m === 'object' ? m : {}) as Record<string, unknown>)
    .map((m): DraftMember => {
      const name = text(m.name, 60);
      return {
        name,
        callName: text(m.callName, 40) || callNameOf(name),
        savingFor: text(m.savingFor, 120),
        privateDetail: text(m.privateDetail, 200),
        needBy: isoDate(m.needBy),
        isNew: m.isNew === true,
        paysCash: m.paysCash === true,
        isHost: m.isHost === true,
        language: LANGUAGES.includes(m.language as LanguageCode) ? (m.language as LanguageCode) : 'en',
      };
    })
    .filter((m) => m.name)
    .map((m) => {
      // Two people with one name would be one row in the ledger, so tell them apart.
      let { name, callName } = m;
      for (let n = 2; seen.has(name.toLowerCase()); n++) {
        name = `${m.name} ${n}`;
        callName = `${m.callName} ${n}`;
      }
      seen.add(name.toLowerCase());
      return { ...m, name, callName };
    });

  if (members.length < MIN_MEMBERS) problems.push(`A circle needs at least ${MIN_MEMBERS} people.`);
  if (members.length > MAX_MEMBERS) problems.push(`A circle can have at most ${MAX_MEMBERS} people here.`);

  // Exactly one host: the first one marked, or else the first member who isn't new.
  const marked = members.findIndex((m) => m.isHost);
  const hostAt = marked >= 0 ? marked : Math.max(members.findIndex((m) => !m.isNew), 0);
  members.forEach((m, i) => {
    m.isHost = i === hostAt;
  });

  const hand = Math.round(Number(input.handAmount) * 100) / 100;
  const handAmount = Number.isFinite(hand) && hand > 0 && hand <= MAX_HAND ? hand : 0;
  if (!handAmount) problems.push(`The hand must be an amount between $1 and $${MAX_HAND}.`);

  const start = isoDate(input.startDate);
  const startDate = start && start > today ? start : nextMonday(today);

  return {
    draft: { name: text(input.name, 60) || 'My partner', handAmount, startDate, members },
    problems,
  };
}

/** A short id that is safe in threads, CSS names and PayPal invoice numbers. */
export function memberId(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/^(miss|mr|mrs|ms)\.? +/, '')
      .split(/\s+/)[0]
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'member';
  let id = base;
  // "host" is the host console's thread, so no member can have it.
  for (let n = 2; taken.has(id) || id === 'host'; n++) id = `${base}${n}`;
  return id;
}
