// The PayPal ledger's rows, and the plain description of a filter over them.
// Shared so the grid and the server that answers questions about it agree on what's there.
import type { Snapshot } from './types.js';

export interface LedgerRow {
  week: number;
  date: string;
  member: string;
  kind: 'Hand' | 'Draw';
  amount: number;
  status: string;
  method: string;
  reference: string;
}

export const LEDGER_COLUMNS = ['week', 'member', 'kind', 'amount', 'status', 'method', 'reference', 'date'] as const;
export type LedgerColumn = (typeof LEDGER_COLUMNS)[number];

/** What "Ask the ledger" hands the grid. filterModel is ready for AG Grid's setFilterModel. */
export interface LedgerAnswer {
  /** False means the question wasn't one the ledger can answer: leave the grid as it is. */
  understood: boolean;
  /** One short sentence saying what the grid now shows. */
  answer: string;
  filterModel: Record<string, unknown>;
  sort: { column: LedgerColumn; direction: 'asc' | 'desc' } | null;
  source: 'model' | 'rules';
}

function dayOf(startDate: string, frequencyDays: number, week: number): string {
  return new Date(Date.parse(`${startDate}T00:00:00Z`) + (week - 1) * frequencyDays * 86_400_000).toISOString().slice(0, 10);
}

export function ledgerRows({ circle, members, hands, draws }: Pick<Snapshot, 'circle' | 'members' | 'hands' | 'draws'>): LedgerRow[] {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const weekDay = (week: number) => dayOf(circle.startDate, circle.frequencyDays, week);
  const out: LedgerRow[] = [];
  for (const h of hands) {
    if (h.status === 'upcoming') continue;
    out.push({
      week: h.week,
      date: (h.paidAt ?? weekDay(h.week)).slice(0, 10),
      member: nameOf(h.memberId),
      kind: 'Hand',
      amount: h.amount,
      status: h.status === 'paid' ? 'Paid' : h.remindersSent ? 'Reminded' : 'Due',
      method:
        h.status !== 'paid'
          ? 'PayPal invoice sent'
          : h.method === 'cash'
            ? h.invoiceNumber
              ? 'Cash, recorded on invoice'
              : 'Cash'
            : h.method === 'book'
              ? 'Partner book'
              : 'PayPal',
      reference: h.invoiceNumber ?? (h.method === 'book' || h.method === 'cash' ? 'Paper book' : ''),
    });
  }
  for (const d of draws) {
    if (d.status === 'upcoming' || d.status === 'collecting') continue;
    const status =
      d.status === 'paid'
        ? 'Received'
        : d.status === 'processing'
          ? 'Sending'
          : d.status === 'awaiting_approval'
            ? 'Awaiting approval'
            : d.status === 'ready'
              ? 'Ready'
              : 'Failed';
    out.push({
      week: d.week,
      date: (d.paidAt ?? weekDay(d.week)).slice(0, 10),
      member: nameOf(d.memberId),
      kind: 'Draw',
      amount: d.amount,
      status,
      method: d.method === 'book' ? 'Partner book' : 'PayPal Payout',
      reference: d.transactionId ?? d.payoutBatchId ?? (d.method === 'book' ? 'Paper book' : ''),
    });
  }
  return out.sort((a, b) => b.week - a.week || (a.kind === b.kind ? a.member.localeCompare(b.member) : a.kind === 'Draw' ? -1 : 1));
}
