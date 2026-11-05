// Offline mode: simple rules that cover the demo when no Anthropic key is set.
// The same actions run underneath, so PayPal behaves exactly as it does with Claude.
import type { Member, Message } from '../../shared/types.js';
import * as actions from '../actions.js';
import { drawWeekOf, explainOrder, findSwapOptions, weekDate } from '../domain/circle.js';
import { longDay, money } from '../domain/dates.js';
import { store } from '../store.js';
import { say } from './templates.js';
import type { Role } from './tools.js';

function mentioned(text: string): Member[] {
  const t = ` ${text.toLowerCase()} `;
  return store.state.members.filter((m) => {
    const first = m.name.split(' ')[0].toLowerCase();
    return t.includes(` ${first}`) || t.includes(m.callName.toLowerCase());
  });
}

function unpaidThisWeek(): Member[] {
  const week = store.state.circle.currentWeek;
  return store.state.hands
    .filter((h) => h.week === week && h.status !== 'paid')
    .map((h) => store.member(h.memberId));
}

async function hostReply(text: string): Promise<string> {
  const t = text.toLowerCase();
  const s = store.state;
  if (s.circle.phase === 'draft') {
    const why = explainOrder(s.circle, s.members, s.draws, s.swaps)
      .map((p) => `Week ${p.week}, ${store.member(p.memberId).callName}: ${p.reason}`)
      .join(' ');
    return `Nothing has gone to PayPal yet. ${why} Tap Send the first invoices when it looks right.`;
  }
  const names = mentioned(t).filter((m) => !m.isHost);

  if (/\bcash\b|gave me|paid me|collected/.test(t) && names.length) {
    const results = [];
    for (const m of names) results.push(await actions.recordCash(m.id));
    return results.join(' ');
  }
  // Only an instruction sends reminders; a question like "who still owes?" just gets the status.
  if (/\b(remind|nudge|chase|follow up)\b/.test(t)) {
    const targets = (names.length ? names : unpaidThisWeek()).filter((m) =>
      unpaidThisWeek().some((u) => u.id === m.id),
    );
    if (!targets.length) return 'Everyone has paid this week, so there is nobody to remind.';
    const results = [];
    for (const m of targets) results.push(await actions.sendReminder(m.id));
    return results.join(' ');
  }
  if (/payout|pay (out|the draw)|send (the )?draw|approve|release/.test(t)) {
    return actions.requestPayout();
  }
  if (/refresh|check paypal|sync/.test(t)) {
    return actions.refreshFromPayPal();
  }
  if (/swap/.test(t)) {
    return 'Members can ask me for an earlier draw in their own chat. I only ask someone to swap if their money still lands before they need it, and nothing changes until they say yes.';
  }
  const st = actions.statusFor();
  return `Week ${st.current_week}: ${st.this_week.summary} ${st.this_week.recipient} draws ${st.draw_amount} on ${st.this_week.draw_date}.`;
}

async function memberReply(m: Member, text: string): Promise<string> {
  const t = text.toLowerCase();
  const s = store.state;
  const c = s.circle;
  const myWeek = drawWeekOf(c, m.id);
  const pot = money(c.handAmount * c.memberIds.length);
  const hand = store.hand(m.id, c.currentWeek);
  if (c.phase === 'draft') {
    return say.myDraw(m, { week: myWeek, date: longDay(weekDate(c, myWeek)), pot, handLine: '' }).trim();
  }
  const handLine =
    hand?.status === 'paid'
      ? m.language === 'jm'
        ? `Yuh Week ${c.currentWeek} hand paid already.`
        : `Your Week ${c.currentWeek} hand is paid.`
      : m.language === 'jm'
        ? `Yuh Week ${c.currentWeek} hand (${money(hand?.amount ?? c.handAmount)}) still due.`
        : `Your Week ${c.currentWeek} hand (${money(hand?.amount ?? c.handAmount)}) is still due.`;

  if (/hospital|emergency|sick|urgent|early|swap|need (mi|my|the) (draw|money)|before my turn|can i get|fi get|asap|right now|tonight/.test(t)) {
    if (myWeek <= c.currentWeek) {
      return say.myDraw(m, { week: myWeek, date: longDay(weekDate(c, myWeek)), pot, handLine });
    }
    m.goal = { ...m.goal, needBy: weekDate(c, c.currentWeek) };
    store.log('banker', `${m.callName} needs the money now.`);
    const best = findSwapOptions(c, s.members, s.draws, m.id).find((o) => o.allowed && o.harmDays === 0);
    const hostName = store.member(c.hostId).callName;
    if (!best) {
      store.addMessage({
        thread: 'host',
        from: 'banker',
        kind: 'text',
        text: `${m.callName} needs their draw early, but every earlier week belongs to someone who would be hurt by moving. Can you help find a way?`,
      });
      return say.noSwapPossible(m, { hostName });
    }
    const counterparty = store.member(best.counterpartyId);
    actions.requestSwap(m.id, counterparty.id, 'a family emergency');
    return say.swapRequestedAck(m, {
      counterpartyName: counterparty.callName,
      week: best.targetWeek,
      date: longDay(best.targetDate),
    });
  }
  if (/\bpay\b|link|invoice|how (do|to) i pay/.test(t) && hand && hand.status !== 'paid') {
    store.addMessage({
      thread: m.id,
      from: 'banker',
      kind: 'pay_request',
      text: `Week ${hand.week} hand: ${money(hand.amount)}.`,
      data: { handId: hand.id, week: hand.week, amount: hand.amount },
    });
    return m.language === 'jm' ? 'Tap di button fi pay inna PayPal.' : 'Tap the button to pay in PayPal.';
  }
  if (/thank|tank|bless/.test(t)) return say.thanks(m);
  return say.myDraw(m, { week: myWeek, date: longDay(weekDate(c, myWeek)), pot, handLine });
}

export async function offlineReply(_thread: string, role: Role, speaker: Member, latest: Message): Promise<string> {
  return role === 'host' ? hostReply(latest.text) : memberReply(speaker, latest.text);
}
