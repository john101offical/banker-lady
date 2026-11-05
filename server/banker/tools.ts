// The tools the AI banker can use. Each one calls the same actions as the app's buttons.
// Money never moves from here: payouts only create an approval request for the host.
import type Anthropic from '@anthropic-ai/sdk';
import type { LanguageCode } from '../../shared/types.js';
import * as actions from '../actions.js';
import { drawWeekOf, findSwapOptions, weekDate } from '../domain/circle.js';
import { longDay, money, shortDay } from '../domain/dates.js';
import { store } from '../store.js';

export type Role = 'host' | 'member';

export interface ToolContext {
  speakerId: string;
  role: Role;
}

interface BankerTool {
  def: Anthropic.Tool;
  roles: Role[];
  run(input: Record<string, any>, ctx: ToolContext): Promise<unknown> | unknown;
}

const LANGUAGE_NAME: Record<LanguageCode, string> = {
  en: 'English',
  jm: 'Jamaican Patois',
  es: 'Spanish',
  ht: 'Haitian Creole',
};

const memberIdProp = () => ({
  type: 'string' as const,
  enum: store.state.members.map((m) => m.id),
  description: 'Member id',
});

function selfOnly(input: Record<string, any>, ctx: ToolContext, key = 'member_id'): string {
  const id = String(input[key] ?? ctx.speakerId);
  if (ctx.role === 'member' && id !== ctx.speakerId) {
    throw new Error('Members can only do this for themselves. Ask the host to help with other members.');
  }
  store.member(id);
  return id;
}

function memberView(id: string) {
  const s = store.state;
  const m = store.member(id);
  const week = drawWeekOf(s.circle, id);
  const hand = store.hand(id, s.circle.currentWeek);
  return {
    member_id: m.id,
    name: m.name,
    call_name: m.callName,
    language: m.language,
    saving_for: m.goal.label,
    need_by: m.goal.needBy ? longDay(m.goal.needBy) : 'no fixed date',
    new_to_circle: m.isNew,
    pays_cash: m.paysCash,
    draw_week: week,
    draw_date: longDay(weekDate(s.circle, week)),
    draw_status: store.draw(week)?.status,
    this_week_hand: hand ? { status: hand.status, method: hand.method ?? null, reminders_sent: hand.remindersSent } : null,
  };
}

/** What one member may see about another: when they draw and how to write to them. Goals stay private. */
function publicView(id: string) {
  const s = store.state;
  const m = store.member(id);
  const week = drawWeekOf(s.circle, id);
  return {
    member_id: m.id,
    call_name: m.callName,
    language: LANGUAGE_NAME[m.language],
    draw_week: week,
    draw_date: longDay(weekDate(s.circle, week)),
    draw_status: store.draw(week)?.status,
  };
}

const TOOLS = (): BankerTool[] => [
  {
    def: {
      name: 'get_circle_status',
      description:
        "This week's hands (who paid, how, reminders sent), who draws each week and when, pending swaps and payout approvals. Call it before answering anything about money or dates.",
      input_schema: { type: 'object', properties: {} },
    },
    roles: ['host', 'member'],
    run: () => actions.statusFor(),
  },
  {
    def: {
      name: 'get_member',
      description:
        "One member's language, draw week and status. For the host, or for a member asking about themselves, also their goal, need-by date and this week's hand. Other members' goals are private.",
      input_schema: { type: 'object', properties: { member_id: memberIdProp() }, required: ['member_id'] },
    },
    roles: ['host', 'member'],
    run: (input, ctx) => {
      const id = String(input.member_id);
      return ctx.role === 'member' && id !== ctx.speakerId ? publicView(id) : memberView(id);
    },
  },
  {
    def: {
      name: 'find_swap_options',
      description:
        'For a member who needs their draw sooner: the earlier weeks they could swap into, best first. harm_days is how many days late the other member would become (0 means no harm). allowed=false means the trust rule blocks it.',
      input_schema: { type: 'object', properties: { member_id: memberIdProp() }, required: ['member_id'] },
    },
    roles: ['host', 'member'],
    run: (input, ctx) => {
      const id = selfOnly(input, ctx);
      const s = store.state;
      return findSwapOptions(s.circle, s.members, s.draws, id).map((o) => ({
        counterparty_id: o.counterpartyId,
        counterparty: store.member(o.counterpartyId).callName,
        counterparty_language: LANGUAGE_NAME[store.member(o.counterpartyId).language],
        target_week: o.targetWeek,
        target_date: longDay(o.targetDate),
        counterparty_would_move_to: `Week ${o.counterpartyNewWeek} (${longDay(o.counterpartyNewDate)})`,
        harm_days: o.harmDays,
        allowed: o.allowed,
        why: o.why,
      }));
    },
  },
  {
    def: {
      name: 'update_need_date',
      description:
        "Record that a member now needs their money by a new date, e.g. after an emergency. For 'now' or 'as soon as possible', use this week's draw_date_iso from get_circle_status.",
      input_schema: {
        type: 'object',
        properties: {
          member_id: memberIdProp(),
          need_by: { type: 'string', description: 'YYYY-MM-DD, with the year taken from the circle dates' },
        },
        required: ['member_id', 'need_by'],
      },
    },
    roles: ['host', 'member'],
    run: (input, ctx) => {
      const id = selfOnly(input, ctx);
      const m = store.member(id);
      const needBy = String(input.need_by).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(needBy) || Number.isNaN(Date.parse(needBy))) {
        throw new Error('need_by must be a real date written YYYY-MM-DD');
      }
      const { circle } = store.state;
      if (needBy < circle.startDate) {
        throw new Error(
          `need_by ${needBy} is before this circle began on ${circle.startDate}. This week's draw date is ${weekDate(circle, circle.currentWeek)}.`,
        );
      }
      // The goal's wording stays as it is: the book shows it, and an emergency's details are private.
      m.goal = { ...m.goal, needBy };
      store.log('banker', `${m.callName} now needs the money by ${shortDay(needBy)}.`);
      return { ok: true, need_by: longDay(needBy) };
    },
  },
  {
    def: {
      name: 'request_swap',
      description:
        "Ask another member, in their chat, to swap draw weeks with the requester. Nothing changes until they accept. Use only an option from find_swap_options with allowed=true, preferring harm_days=0. reason_public is all the other member learns about why; keep it general, e.g. 'a family emergency'. Write message_to_counterparty in counterparty_language from find_swap_options, not the requester's language; include both dates, and say nothing changes unless they agree.",
      input_schema: {
        type: 'object',
        properties: {
          requester_id: memberIdProp(),
          counterparty_id: memberIdProp(),
          reason_public: { type: 'string' },
          message_to_counterparty: { type: 'string' },
        },
        required: ['requester_id', 'counterparty_id', 'reason_public'],
      },
    },
    roles: ['host', 'member'],
    run: (input, ctx) => {
      const requester = selfOnly(input, ctx, 'requester_id');
      const r = actions.requestSwap(
        requester,
        String(input.counterparty_id),
        String(input.reason_public ?? 'a family emergency'),
        input.message_to_counterparty ? String(input.message_to_counterparty) : undefined,
      );
      return { ok: r.ok, result: r.text };
    },
  },
  {
    def: {
      name: 'send_pay_link',
      description: "Put a PayPal pay button for this week's hand in the member's chat.",
      input_schema: { type: 'object', properties: { member_id: memberIdProp() }, required: ['member_id'] },
    },
    roles: ['host', 'member'],
    run: (input, ctx) => {
      const id = selfOnly(input, ctx);
      const s = store.state;
      const hand = store.hand(id, s.circle.currentWeek);
      if (!hand) return { ok: false, result: 'No hand this week.' };
      if (hand.status === 'paid') return { ok: true, result: 'Already paid this week.' };
      store.addMessage({
        thread: id,
        from: 'banker',
        kind: 'pay_request',
        text: `Week ${hand.week} hand: ${money(hand.amount)}.`,
        data: { handId: hand.id, week: hand.week, amount: hand.amount },
      });
      return { ok: true, result: 'Pay button sent.' };
    },
  },
  {
    def: {
      name: 'record_cash_hand',
      description:
        "Host only. Records that a member handed the host cash for a hand. Marks that member's PayPal invoice paid with method CASH.",
      input_schema: {
        type: 'object',
        properties: { member_id: memberIdProp(), week: { type: 'integer', description: 'Defaults to the current week' } },
        required: ['member_id'],
      },
    },
    roles: ['host'],
    run: async (input) => ({ result: await actions.recordCash(String(input.member_id), input.week ? Number(input.week) : undefined) }),
  },
  {
    def: {
      name: 'send_hand_reminder',
      description:
        "Host only. Sends a member a kind reminder in their chat with a PayPal pay button, and has PayPal send its invoice reminder. Write `message` yourself, in the member's language, warm and never shaming; mention the amount and whose draw is waiting.",
      input_schema: {
        type: 'object',
        properties: { member_id: memberIdProp(), message: { type: 'string' } },
        required: ['member_id', 'message'],
      },
    },
    roles: ['host'],
    run: async (input) => ({ result: await actions.sendReminder(String(input.member_id), String(input.message ?? '')) }),
  },
  {
    def: {
      name: 'request_draw_payout',
      description:
        "Asks the host to approve paying this week's draw through PayPal Payouts. Works only when every hand is in. Money moves only after the host taps Approve in the app.",
      input_schema: {
        type: 'object',
        properties: { note: { type: 'string', description: 'One sentence for the approval card' } },
      },
    },
    roles: ['host'],
    run: (input) => ({ result: actions.requestPayout(undefined, input.note ? String(input.note) : undefined) }),
  },
  {
    def: {
      name: 'refresh_from_paypal',
      description: 'Checks PayPal for newly paid invoices and settled payouts.',
      input_schema: { type: 'object', properties: {} },
    },
    roles: ['host'],
    run: async () => ({ result: await actions.refreshFromPayPal() }),
  },
  {
    def: {
      name: 'message_member',
      description: "Host only. Sends a short message to a member's chat. Never share anyone's private reasons.",
      input_schema: {
        type: 'object',
        properties: { member_id: memberIdProp(), text: { type: 'string' } },
        required: ['member_id', 'text'],
      },
    },
    roles: ['host'],
    run: (input) => {
      store.addMessage({ thread: String(input.member_id), from: 'banker', kind: 'text', text: String(input.text) });
      return { ok: true };
    },
  },
];

export function toolsFor(role: Role) {
  const list = TOOLS().filter((t) => t.roles.includes(role));
  return {
    defs: list.map((t) => t.def),
    async run(name: string, input: Record<string, any>, ctx: ToolContext): Promise<unknown> {
      const tool = list.find((t) => t.def.name === name);
      const started = Date.now();
      const trace = (outcome: string) =>
        console.log(
          `[banker] ${ctx.role}/${ctx.speakerId} ${name} ${outcome} ${Date.now() - started}ms${process.env.BANKER_DEBUG ? ` ${JSON.stringify(input)}` : ''}`,
        );
      if (!tool) {
        trace('refused');
        throw new Error(`Tool ${name} isn't available here.`);
      }
      try {
        const out = await tool.run(input ?? {}, ctx);
        trace('ok');
        return out;
      } catch (e) {
        trace('error');
        throw e;
      }
    },
  };
}
