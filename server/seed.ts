// The demo circle: six members of the Ward 4 Partner, $50 a week, one $300 draw each Monday.
// Weeks 1 and 2 ran on Miss P's paper partner book; from Week 3 everything runs through PayPal.
import type { Draw, Hand, Member, Message } from '../shared/types.js';
import { issueInvoices, newRunTag } from './actions.js';
import { config } from './config.js';
import { planDrawOrder, weekDate } from './domain/circle.js';
import { longDay, nowIso } from './domain/dates.js';
import { newId, store, type State } from './store.js';

const START = '2026-11-16';
const HAND = 50;

function email(id: string): string {
  return config.memberEmails[id] || config.defaultMemberEmail || `${id}@banker-lady.example.com`;
}

export function demoMembers(): Member[] {
  const m = (x: Omit<Member, 'email'>): Member => ({ ...x, email: email(x.id) });
  return [
    m({
      id: 'joyce',
      name: 'Joyce Reid',
      callName: 'Miss Joyce',
      language: 'jm',
      goal: { label: 'a new fridge; hers died', needBy: '2026-11-20' },
      isNew: false,
      circlesCompleted: 9,
      paysCash: true,
      swapPolicy: 'ask',
      color: '#A0442F',
    }),
    m({
      id: 'kezia',
      name: 'Kezia Brown',
      callName: 'Kezia',
      language: 'en',
      goal: { label: 'January school fees', needBy: '2027-01-04' },
      isNew: false,
      circlesCompleted: 3,
      paysCash: false,
      swapPolicy: 'ask',
      color: '#2E7D6B',
    }),
    m({
      id: 'andre',
      name: 'Andre Williams',
      callName: 'Andre',
      language: 'en',
      goal: { label: 'a barrel home for Christmas', needBy: '2026-12-08' },
      isNew: false,
      circlesCompleted: 2,
      paysCash: false,
      swapPolicy: 'ask',
      color: '#8A6A1F',
    }),
    m({
      id: 'devon',
      name: 'Devon Campbell',
      callName: 'Devon',
      language: 'jm',
      goal: { label: 'car repair for work', needBy: '2026-11-23' },
      isNew: true,
      circlesCompleted: 0,
      paysCash: false,
      swapPolicy: 'ask',
      color: '#3E54A3',
    }),
    m({
      id: 'pauline',
      name: 'Pauline Grant',
      callName: 'Miss P',
      language: 'en',
      goal: { label: 'a land payment', needBy: '2027-01-15' },
      isNew: false,
      circlesCompleted: 12,
      paysCash: false,
      swapPolicy: 'ask',
      isHost: true,
      color: '#6B3FA0',
    }),
    m({
      id: 'marcia',
      name: 'Marcia Clarke',
      callName: 'Marcia',
      language: 'jm',
      goal: { label: "her mother's medical bills", needBy: null },
      isNew: false,
      circlesCompleted: 4,
      paysCash: false,
      swapPolicy: 'ask',
      color: '#A3325E',
    }),
  ];
}

const CURRENT_WEEK = 3;

/** Week 3 of the circle: four hands in, Miss Joyce (cash) and Devon still to pay. */
export function buildDemoScene(): { state: State; seededPaid: string[] } {
  const members = demoMembers();
  const { order } = planDrawOrder({ members, startDate: START, frequencyDays: 7, trustWeeks: 3 });
  const circle = {
    id: 'ward4',
    name: 'Ward 4 Partner',
    handAmount: HAND,
    currency: 'USD' as const,
    startDate: START,
    frequencyDays: 7,
    memberIds: members.map((x) => x.id),
    drawOrder: order,
    currentWeek: CURRENT_WEEK,
    hostId: 'pauline',
    trustWeeks: 3,
  };
  const n = members.length;
  const hands: Hand[] = [];
  for (let week = 1; week <= n; week++) {
    for (const mem of members) {
      const fromBook = week < CURRENT_WEEK;
      hands.push({
        id: newId('hand'),
        week,
        memberId: mem.id,
        amount: HAND,
        status: fromBook ? 'paid' : week === CURRENT_WEEK ? 'due' : 'upcoming',
        method: fromBook ? (mem.paysCash ? 'cash' : 'book') : undefined,
        paidAt: fromBook ? `${weekDate(circle, week)}T09:00:00.000Z` : undefined,
        remindersSent: 0,
      });
    }
  }
  const draws: Draw[] = order.map((memberId, i) => ({
    id: newId('draw'),
    week: i + 1,
    memberId,
    amount: HAND * n,
    date: weekDate(circle, i + 1),
    status: i + 1 < CURRENT_WEEK ? 'paid' : i + 1 === CURRENT_WEEK ? 'collecting' : 'upcoming',
    method: i + 1 < CURRENT_WEEK ? 'book' : undefined,
    paidAt: i + 1 < CURRENT_WEEK ? `${weekDate(circle, i + 1)}T15:00:00.000Z` : undefined,
  }));

  const recipient = members.find((x) => x.id === order[CURRENT_WEEK - 1])!;
  const name = (id: string) => members.find((x) => x.id === id)!.callName;
  const messages: Message[] = [
    {
      id: newId('msg'),
      thread: 'host',
      from: 'banker',
      kind: 'text',
      createdAt: nowIso(),
      text: `Morning, Miss P. I've copied Weeks 1 and 2 from your partner book, and from now on every hand is a PayPal invoice. ${recipient.callName} draws $${HAND * n} on ${longDay(weekDate(circle, CURRENT_WEEK))}.`,
    },
  ];

  const state: State = {
    circle,
    members,
    hands,
    draws,
    swaps: [],
    approvals: [],
    messages,
    activity: [
      {
        id: newId('act'),
        at: nowIso(),
        kind: 'system',
        text: `Imported Weeks 1 and 2 from Miss P's partner book: every hand in, ${name(order[0])} and ${name(order[1])} drew $${HAND * n} each.`,
      },
    ],
  };
  // In the story, these four paid this week's hands in PayPal before the demo starts.
  return { state, seededPaid: ['pauline', 'kezia', 'andre', 'marcia'] };
}

export async function loadScene(scene = 'demo'): Promise<void> {
  if (scene !== 'demo') throw new Error(`Unknown scene "${scene}"`);
  newRunTag();
  const { state, seededPaid } = buildDemoScene();
  store.load(state);
  await issueInvoices(CURRENT_WEEK, { seededPaid });
}
