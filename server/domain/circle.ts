// The banker's arithmetic: draw dates, a fair draw order, swap options and risk.
import type { Circle, Draw, Hand, Member, PlanReason, RiskSummary, Swap } from '../../shared/types.js';
import { addDays, daysBetween, money, shortDay } from './dates.js';

export function weekDate(circle: Pick<Circle, 'startDate' | 'frequencyDays'>, week: number): string {
  return addDays(circle.startDate, (week - 1) * circle.frequencyDays);
}

export function drawWeekOf(circle: Circle, memberId: string): number {
  return circle.drawOrder.indexOf(memberId) + 1;
}

// ---------------------------------------------------------------------------
// Hungarian algorithm: minimum-cost assignment of n rows to n columns.
// Returns assignment[row] = column.
// ---------------------------------------------------------------------------
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) assignment[p[j] - 1] = j - 1;
  return assignment;
}

// ---------------------------------------------------------------------------
// Draw order
// ---------------------------------------------------------------------------
const FORBIDDEN = 1e9;
const TRUST_PENALTY = 1e6;
const LATE_PER_DAY = 100;

export interface PlanInput {
  members: Member[];
  startDate: string;
  frequencyDays: number;
  trustWeeks: number;
  /** Weeks whose recipient can't change (already paid out). week -> memberId */
  fixed?: Map<number, string>;
}

/**
 * Builds the draw order. Three rules, in priority order:
 * 1. Nobody gets their draw after the date they need it, if it can be helped.
 * 2. New members draw only after paying in for `trustWeeks` weeks.
 * 3. Earlier needs get earlier weeks; flexible members fill the late weeks.
 */
export function planDrawOrder(input: PlanInput): { order: string[]; reasons: PlanReason[] } {
  const { members, trustWeeks } = input;
  const n = members.length;
  const fixed = input.fixed ?? new Map<number, string>();
  const dateOf = (week: number) => addDays(input.startDate, (week - 1) * input.frequencyDays);

  // Rank by need date: earliest need gets the highest priority.
  const ranked = [...members].sort((a, b) => {
    const da = a.goal.needBy ?? '9999-12-31';
    const db = b.goal.needBy ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    if (a.circlesCompleted !== b.circlesCompleted) return b.circlesCompleted - a.circlesCompleted;
    return a.name.localeCompare(b.name);
  });
  const priority = new Map(ranked.map((m, i) => [m.id, n - i]));

  const cost = members.map((m) =>
    Array.from({ length: n }, (_, col) => {
      const week = col + 1;
      const fixedHolder = fixed.get(week);
      if (fixedHolder) return fixedHolder === m.id ? 0 : FORBIDDEN;
      if ([...fixed.values()].includes(m.id)) return FORBIDDEN;
      let c = week * (priority.get(m.id) ?? 1);
      if (m.goal.needBy) {
        const late = Math.max(0, daysBetween(m.goal.needBy, dateOf(week)));
        c += late * LATE_PER_DAY;
      }
      if (m.isNew && week <= trustWeeks) c += TRUST_PENALTY;
      return c;
    }),
  );

  const assignment = hungarian(cost);
  const order = new Array<string>(n);
  members.forEach((m, row) => {
    order[assignment[row]] = m.id;
  });

  const reasons = order.map((memberId, idx) =>
    explainSlot(members.find((m) => m.id === memberId)!, idx + 1, dateOf(idx + 1), trustWeeks, fixed.has(idx + 1), dateOf),
  );
  return { order, reasons };
}

function explainSlot(
  m: Member,
  week: number,
  date: string,
  trustWeeks: number,
  isFixed: boolean,
  dateOf: (w: number) => string,
): PlanReason {
  const slot = `Week ${week} (${shortDay(date)})`;
  if (isFixed) {
    const need = m.goal.needBy ? `, needed by ${shortDay(m.goal.needBy)}` : '';
    return { memberId: m.id, week, date, onTime: true, reason: `${capitalise(m.goal.label)}${need}. Drew ${slot}.` };
  }
  if (!m.goal.needBy) {
    return {
      memberId: m.id,
      week,
      date,
      onTime: true,
      reason: `No fixed date yet, so ${slot} leaves the earlier weeks for members who need money sooner.`,
    };
  }
  const need = shortDay(m.goal.needBy);
  const spare = daysBetween(date, m.goal.needBy);
  if (spare >= 0) {
    const cushion = spare === 0 ? 'right on the day' : `${spare} day${spare === 1 ? '' : 's'} before`;
    return {
      memberId: m.id,
      week,
      date,
      onTime: true,
      reason: `${capitalise(m.goal.label)}, needed by ${need}. ${slot} lands ${cushion}.`,
    };
  }
  // A new member who could have been on time in an early week, but early weeks are for trusted members.
  const blockedByTrust = m.isNew && week > trustWeeks && daysBetween(dateOf(1), m.goal.needBy) >= 0;
  if (blockedByTrust) {
    return {
      memberId: m.id,
      week,
      date,
      onTime: false,
      reason: `${capitalise(m.goal.label)}, needed by ${need}. New to the circle, so draws after paying ${trustWeeks} hands: ${slot}. That protects everyone; a swap is possible later.`,
    };
  }
  return {
    memberId: m.id,
    week,
    date,
    onTime: false,
    reason: `${capitalise(m.goal.label)}, needed by ${need}. ${slot} is the earliest week that keeps everyone else on time.`,
  };
}

function capitalise(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Explains the current order (which may differ from the original plan after swaps). */
export function explainOrder(circle: Circle, members: Member[], draws: Draw[], swaps: Swap[] = []): PlanReason[] {
  const dateOf = (w: number) => weekDate(circle, w);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.callName ?? id;
  return circle.drawOrder.map((memberId, idx) => {
    const week = idx + 1;
    const member = members.find((m) => m.id === memberId)!;
    const draw = draws.find((d) => d.week === week);
    const isFixed = draw?.status === 'paid';
    const base = explainSlot(member, week, dateOf(week), circle.trustWeeks, isFixed, dateOf);
    const asked = swaps.find((s) => s.status === 'pending' && s.requesterId === memberId);
    if (asked && !isFixed) {
      const need = member.goal.needBy ? `, needed by ${shortDay(member.goal.needBy)}` : '';
      return {
        ...base,
        onTime: false,
        reason: `${capitalise(member.goal.label)}${need}. Asked ${nameOf(asked.counterpartyId)} to swap into Week ${asked.toWeek} (${shortDay(dateOf(asked.toWeek))}); waiting for an answer.`,
      };
    }
    return base;
  });
}

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------
export interface SwapOption {
  counterpartyId: string;
  targetWeek: number;
  targetDate: string;
  counterpartyNewWeek: number;
  counterpartyNewDate: string;
  /** Extra days late the counterparty would be after moving. 0 = no harm. */
  harmDays: number;
  allowed: boolean;
  why: string;
}

/** Earlier weeks the requester could swap into, best first. */
export function findSwapOptions(
  circle: Circle,
  members: Member[],
  draws: Draw[],
  requesterId: string,
): SwapOption[] {
  const requester = members.find((m) => m.id === requesterId);
  if (!requester) return [];
  const fromWeek = drawWeekOf(circle, requesterId);
  const fromDate = weekDate(circle, fromWeek);
  const options: SwapOption[] = [];
  for (let w = circle.currentWeek; w < fromWeek; w++) {
    const draw = draws.find((d) => d.week === w);
    if (draw && (draw.status === 'processing' || draw.status === 'paid')) continue;
    const holder = members.find((m) => m.id === circle.drawOrder[w - 1]);
    if (!holder) continue;
    const targetDate = weekDate(circle, w);
    const needBy = holder.goal.needBy;
    const lateBefore = needBy ? Math.max(0, daysBetween(needBy, targetDate)) : 0;
    const lateAfter = needBy ? Math.max(0, daysBetween(needBy, fromDate)) : 0;
    const harmDays = Math.max(0, lateAfter - lateBefore);
    const trustOk = !(requester.isNew && w <= circle.trustWeeks);
    let why: string;
    if (!trustOk) {
      why = `${requester.callName} is new, and new members draw after Week ${circle.trustWeeks}.`;
    } else if (!needBy) {
      why = `${holder.callName} has no fixed date, so Week ${fromWeek} (${shortDay(fromDate)}) still works.`;
    } else if (harmDays === 0) {
      const spare = daysBetween(fromDate, needBy);
      why = `${holder.callName} needs it by ${shortDay(needBy)}; Week ${fromWeek} (${shortDay(fromDate)}) still lands ${spare} days before.`;
    } else {
      why = `${holder.callName} needs it by ${shortDay(needBy)}; Week ${fromWeek} (${shortDay(fromDate)}) would be ${harmDays} days late.`;
    }
    options.push({
      counterpartyId: holder.id,
      targetWeek: w,
      targetDate,
      counterpartyNewWeek: fromWeek,
      counterpartyNewDate: fromDate,
      harmDays,
      allowed: trustOk,
      why,
    });
  }
  return options.sort((a, b) => {
    if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
    if ((a.harmDays === 0) !== (b.harmDays === 0)) return a.harmDays === 0 ? -1 : 1;
    if (a.harmDays !== b.harmDays) return a.harmDays - b.harmDays;
    return a.targetWeek - b.targetWeek;
  });
}

// ---------------------------------------------------------------------------
// Risk: money still owed by members who have already drawn.
// ---------------------------------------------------------------------------
export function computeRisk(circle: Circle, members: Member[], hands: Hand[], draws: Draw[]): RiskSummary {
  const rows = draws
    .filter((d) => d.status === 'paid')
    .map((d) => {
      const owed = hands.filter((h) => h.memberId === d.memberId && h.status !== 'paid');
      const reminders = hands
        .filter((h) => h.memberId === d.memberId && h.week > d.week)
        .reduce((sum, h) => sum + h.remindersSent, 0);
      return {
        memberId: d.memberId,
        drewWeek: d.week,
        handsRemaining: owed.length,
        amountRemaining: owed.reduce((sum, h) => sum + h.amount, 0),
        remindersAfterDraw: reminders,
      };
    });
  const exposure = rows.reduce((sum, r) => sum + r.amountRemaining, 0);
  const watch = rows.filter((r) => r.remindersAfterDraw > 0);
  const name = (id: string) => members.find((m) => m.id === id)?.callName ?? id;
  let note: string;
  if (rows.length === 0) {
    note = 'Nobody has drawn yet, so nobody owes the circle money they have already received.';
  } else if (watch.length === 0) {
    note = `${rows.length === 1 ? name(rows[0].memberId) + ' has' : rows.length + ' members have'} drawn and still owe ${money(exposure)} in hands. Everyone who has drawn is paying on time.`;
  } else {
    note = `${watch.map((r) => name(r.memberId)).join(' and ')} needed reminders after drawing. Banker Lady is watching ${money(watch.reduce((s, r) => s + r.amountRemaining, 0))} of hands still owed.`;
  }
  return { exposure, rows, note };
}
