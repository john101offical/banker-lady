// Everything that changes the circle goes through here: the HTTP routes, the AI banker's
// tools and offline mode all call the same functions, so behaviour is identical everywhere.
import type { Approval, Draw, Hand, Member, Swap } from '../shared/types.js';
import { say } from './banker/templates.js';
import { drawWeekOf, findSwapOptions, weekDate } from './domain/circle.js';
import { daysBetween, longDay, money, nowIso, shortDay } from './domain/dates.js';
import type { PayoutStatus } from './paypal/gateway.js';
import { gateway, PayPalError } from './paypal/index.js';
import { newId, store, type State } from './store.js';

/** Short tag that keeps invoice numbers unique across demo resets. */
let runTag = Date.now().toString(36).slice(-5).toUpperCase();
export function newRunTag() {
  runTag = Date.now().toString(36).slice(-5).toUpperCase();
}

const today = () => new Date().toISOString().slice(0, 10);
const host = (): Member => store.member(store.state.circle.hostId);
const pot = () => store.state.circle.handAmount * store.state.circle.memberIds.length;

/** Hands whose cash is being recorded right now, so the PayPal poll doesn't also report them as paid. */
const recordingCash = new Set<string>();

function errorText(e: unknown): string {
  if (e instanceof PayPalError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** True if a reset happened while we were waiting on PayPal; the result belongs to an old circle. */
function stale(s: State): boolean {
  return store.state !== s;
}

function handsFor(week: number): Hand[] {
  return store.state.hands.filter((h) => h.week === week);
}

function recipientOf(week: number): Member {
  return store.member(store.state.circle.drawOrder[week - 1]);
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

/** Creates and sends a PayPal invoice for every member's hand in a week. */
export async function issueInvoices(week: number, opts: { seededPaid?: string[] } = {}): Promise<void> {
  const s = store.state;
  const { circle } = s;
  const date = weekDate(circle, week);
  const due = date > today() ? date : today();
  const recipient = recipientOf(week);
  const draw = store.draw(week);
  if (draw && draw.status === 'upcoming') draw.status = 'collecting';
  store.changed();

  const queue = s.members.slice();
  let sent = 0;
  const failures: string[] = [];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const hand = s.hands.find((h) => h.memberId === m!.id && h.week === week);
      if (!hand || hand.invoiceId) continue;
      const [givenName, ...rest] = m.name.split(' ');
      try {
        const res = await gateway.createAndSendInvoice({
          invoiceNumber: `BL-${runTag}-W${week}-${m.id.toUpperCase()}`.slice(0, 25),
          businessName: `${circle.name} (Banker Lady)`,
          recipient: { givenName, surname: rest.join(' ') || givenName, email: m.email },
          amount: hand.amount,
          currency: circle.currency,
          itemName: `Partner hand, Week ${week}`,
          itemDescription: `${circle.name}: ${recipient.callName} draws ${money(pot())} on ${longDay(date)}.`,
          dueDate: due,
          note: 'Thank you for keeping the circle strong. Banker Lady',
        });
        if (stale(s)) return;
        hand.invoiceId = res.invoiceId;
        hand.invoiceNumber = `BL-${runTag}-W${week}-${m.id.toUpperCase()}`.slice(0, 25);
        hand.payUrl = res.payUrl;
        if (hand.status === 'upcoming') hand.status = 'due';
        sent += 1;
        if (opts.seededPaid?.includes(m.id)) {
          await gateway.recordPayment(res.invoiceId, {
            method: 'PAYPAL',
            amount: hand.amount,
            currency: circle.currency,
            date: today(),
            note: 'Seeded demo payment',
          });
          if (stale(s)) return;
          hand.status = 'paid';
          hand.method = 'paypal';
          hand.paidAt = nowIso();
        }
        store.addMessage({
          thread: m.id,
          from: 'banker',
          kind: 'pay_request',
          text: say.payRequest(m, {
            week,
            amount: money(hand.amount),
            date: longDay(date),
            recipientName: recipient.callName,
            pot: money(pot()),
            isRecipient: recipient.id === m.id,
          }),
          data: { handId: hand.id, week, amount: hand.amount },
        });
        store.changed();
      } catch (e) {
        failures.push(`${m.callName}: ${errorText(e)}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (stale(s)) return;
  if (sent) store.log('paypal', `Sent ${sent} PayPal invoices for Week ${week} hands (${money(circle.handAmount)} each).`);
  if (failures.length) {
    store.setNotice('error', `PayPal couldn't create ${failures.length} invoice(s). ${failures[0]}`);
    store.log('system', `PayPal invoice errors: ${failures.join(' | ')}`);
  }
  checkDrawReady(week);
}

/** The host says a member paid cash: record it on that member's PayPal invoice. */
export async function recordCash(memberId: string, week = store.state.circle.currentWeek): Promise<string> {
  const s = store.state;
  const m = store.member(memberId);
  const hand = store.hand(memberId, week);
  if (!hand) return `${m.callName} has no hand for Week ${week}.`;
  if (hand.status === 'paid') return `${m.callName}'s Week ${week} hand is already paid (${hand.method}).`;
  if (recordingCash.has(hand.id)) return `${m.callName}'s cash hand is already being recorded.`;
  if (hand.invoiceId) {
    recordingCash.add(hand.id);
    try {
      await gateway.recordPayment(hand.invoiceId, {
        method: 'CASH',
        amount: hand.amount,
        currency: s.circle.currency,
        date: today(),
        note: `Cash handed to ${host().callName}`,
      });
    } finally {
      recordingCash.delete(hand.id);
    }
    if (stale(s)) return 'The demo was reset.';
  }
  hand.status = 'paid';
  hand.method = 'cash';
  hand.paidAt = nowIso();
  store.log(
    'paypal',
    hand.invoiceNumber
      ? `Recorded ${m.callName}'s ${money(hand.amount)} cash hand on PayPal invoice ${hand.invoiceNumber}.`
      : `Recorded ${m.callName}'s ${money(hand.amount)} cash hand.`,
    hand.invoiceId,
  );
  store.addMessage({
    thread: m.id,
    from: 'banker',
    kind: 'text',
    text: say.cashThanks(m, { week, amount: money(hand.amount) }),
  });
  checkDrawReady(week);
  return `Recorded ${m.callName}'s ${money(hand.amount)} cash hand for Week ${week} on PayPal. ${progressLine(week)}`;
}

/** A member's invoice was paid in PayPal (seen by polling, or simulated in mock mode). */
export function markHandPaid(hand: Hand, method: 'paypal' | 'cash') {
  if (hand.status === 'paid') return;
  const m = store.member(hand.memberId);
  hand.status = 'paid';
  hand.method = method;
  hand.paidAt = nowIso();
  store.log('paypal', `${m.callName} paid the Week ${hand.week} hand (${money(hand.amount)}) in PayPal.`, hand.invoiceId);
  store.addMessage({ thread: m.id, from: 'banker', kind: 'text', text: say.paidThanks(m, { week: hand.week }) });
  checkDrawReady(hand.week);
}

/** Mock mode: what PayPal does when the member taps Pay. */
export async function simulatePayPalPayment(handId: string): Promise<void> {
  const s = store.state;
  const hand = s.hands.find((h) => h.id === handId);
  if (!hand) throw new Error('Unknown hand');
  if (hand.status === 'paid') return;
  if (!gateway.simulateInvoicePayment || !hand.invoiceId) throw new Error('This hand has no invoice to pay yet.');
  await gateway.simulateInvoicePayment(hand.invoiceId);
  if (stale(s)) return;
  markHandPaid(hand, 'paypal');
}

/** Sends a reminder in the member's thread, plus PayPal's own invoice reminder. */
export async function sendReminder(memberId: string, text?: string, week = store.state.circle.currentWeek): Promise<string> {
  const s = store.state;
  const m = store.member(memberId);
  const hand = store.hand(memberId, week);
  if (!hand) return `${m.callName} has no hand for Week ${week}.`;
  if (hand.status === 'paid') return `${m.callName} already paid Week ${week}; no reminder needed.`;
  const date = weekDate(s.circle, week);
  const message =
    text?.trim() ||
    say.reminder(m, { week, amount: money(hand.amount), date: longDay(date), recipientName: recipientOf(week).callName });
  let paypalNote = '';
  if (hand.invoiceId) {
    try {
      await gateway.sendReminder(hand.invoiceId, `Reminder: your Week ${week} partner hand`, message.slice(0, 3900));
      paypalNote = ' PayPal also sent its invoice reminder.';
    } catch (e) {
      paypalNote = ` (PayPal reminder failed: ${errorText(e)})`;
    }
    if (stale(s)) return 'The demo was reset.';
  }
  hand.remindersSent += 1;
  hand.lastReminderAt = nowIso();
  store.addMessage({
    thread: m.id,
    from: 'banker',
    kind: 'pay_request',
    text: message,
    data: { handId: hand.id, week, amount: hand.amount, reminder: true },
  });
  store.log('banker', `Reminded ${m.callName} about the Week ${week} hand.${paypalNote}`, hand.invoiceId);
  return `Sent ${m.callName} a reminder in ${m.language === 'jm' ? 'Patois' : 'English'} with a PayPal pay button.${paypalNote}`;
}

function progressLine(week: number): string {
  const hands = handsFor(week);
  const paid = hands.filter((h) => h.status === 'paid').length;
  if (paid === hands.length) return `All ${hands.length} hands are in for Week ${week}.`;
  const waiting = hands.filter((h) => h.status !== 'paid').map((h) => store.member(h.memberId).callName);
  return `${paid} of ${hands.length} hands are in; waiting on ${waiting.join(' and ')}.`;
}

// ---------------------------------------------------------------------------
// Draws and approvals
// ---------------------------------------------------------------------------

export function checkDrawReady(week: number) {
  const draw = store.draw(week);
  if (!draw || week !== store.state.circle.currentWeek) return;
  if (['awaiting_approval', 'processing', 'paid'].includes(draw.status)) return;
  const allPaid = handsFor(week).every((h) => h.status === 'paid');
  if (allPaid) {
    if (draw.status !== 'ready') {
      draw.status = 'ready';
      store.log('banker', `All hands are in for Week ${week}. ${store.member(draw.memberId).callName}'s ${money(draw.amount)} draw is ready.`);
    }
    requestPayout(week);
  } else if (draw.status === 'upcoming') {
    draw.status = 'collecting';
    store.changed();
  }
}

/** The banker asks the host to approve a draw. Money only moves after approval. */
export function requestPayout(week = store.state.circle.currentWeek, note?: string): string {
  const draw = store.draw(week);
  if (!draw) return `There is no draw in Week ${week}.`;
  const m = store.member(draw.memberId);
  if (draw.status === 'paid') return `${m.callName}'s Week ${week} draw is already paid.`;
  if (draw.status === 'processing') return `${m.callName}'s draw is already on its way through PayPal.`;
  if (draw.status !== 'ready' && draw.status !== 'awaiting_approval' && draw.status !== 'failed') {
    return `Not yet: ${progressLine(week)}`;
  }
  const existing = store.state.approvals.find((a) => a.week === week && a.status === 'pending');
  if (existing && existing.memberId === draw.memberId) return `Already waiting for ${host().callName} to approve ${m.callName}'s draw.`;
  if (existing) existing.status = 'superseded';
  const approval: Approval = {
    id: newId('apr'),
    kind: 'payout',
    week,
    memberId: m.id,
    amount: draw.amount,
    note: note ?? `All ${handsFor(week).length} hands are in for Week ${week}.`,
    status: 'pending',
    createdAt: nowIso(),
  };
  store.state.approvals.push(approval);
  draw.status = 'awaiting_approval';
  store.addMessage({
    thread: 'host',
    from: 'banker',
    kind: 'approval',
    text: `${approval.note} Pay ${m.callName}'s ${money(draw.amount)} draw to their PayPal now?`,
    data: { approvalId: approval.id },
  });
  store.log('banker', `Asked ${host().callName} to approve ${m.callName}'s ${money(draw.amount)} Week ${week} draw.`);
  return `Asked ${host().callName} to approve paying ${m.callName}'s ${money(draw.amount)} draw.`;
}

export async function decideApproval(approvalId: string, approve: boolean): Promise<string> {
  const s = store.state;
  const approval = s.approvals.find((a) => a.id === approvalId);
  if (!approval) throw new Error('Unknown approval');
  if (approval.status !== 'pending') return `That request was already ${approval.status}.`;
  const draw = store.draw(approval.week)!;
  const m = store.member(approval.memberId);
  if (!approve) {
    approval.status = 'declined';
    draw.status = 'ready';
    store.addMessage({ thread: 'host', from: 'banker', kind: 'text', text: `Okay. I'll hold ${m.callName}'s draw until you say so.` });
    store.log('host', `${host().callName} held ${m.callName}'s Week ${approval.week} draw.`);
    return 'Held.';
  }
  approval.status = 'approved';
  draw.status = 'processing';
  draw.failureReason = undefined;
  store.log('host', `${host().callName} approved ${m.callName}'s ${money(draw.amount)} draw.`);
  try {
    const res = await gateway.createPayout({
      senderBatchId: `BL-${runTag}-W${draw.week}-${Date.now().toString(36)}`,
      senderItemId: `draw-w${draw.week}-${m.id}`,
      receiverEmail: m.email,
      amount: draw.amount,
      currency: s.circle.currency,
      note: `Your Week ${draw.week} draw from ${s.circle.name}`,
      emailSubject: 'Your partner draw is here',
      emailMessage: `${s.circle.name}: your Week ${draw.week} draw of ${money(draw.amount)} is in your PayPal. Banker Lady`,
    });
    if (stale(s)) return 'The demo was reset.';
    draw.payoutBatchId = res.batchId;
    draw.method = 'payout';
    store.log('paypal', `PayPal Payout ${res.batchId} created: ${money(draw.amount)} to ${m.callName}.`, res.batchId);
    void watchPayout(draw, s);
    return `Sent ${m.callName}'s ${money(draw.amount)} draw through PayPal Payouts.`;
  } catch (e) {
    if (stale(s)) return 'The demo was reset.';
    draw.status = 'failed';
    draw.failureReason = errorText(e);
    store.setNotice('error', `PayPal didn't accept the payout. ${draw.failureReason}`);
    store.addMessage({
      thread: 'host',
      from: 'banker',
      kind: 'text',
      text: `PayPal didn't accept ${m.callName}'s payout: ${draw.failureReason}. Nothing was sent. Check the sandbox balance and try again.`,
    });
    approval.status = 'declined';
    draw.status = 'ready';
    return `Payout failed: ${draw.failureReason}`;
  }
}

async function watchPayout(draw: Draw, s: State) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 1000 : 4000));
    if (stale(s) || draw.status !== 'processing' || !draw.payoutBatchId) return;
    try {
      const st = await gateway.getPayoutStatus(draw.payoutBatchId);
      if (stale(s)) return;
      applyPayoutStatus(draw, st);
    } catch (e) {
      store.log('system', `Couldn't check payout ${draw.payoutBatchId}: ${errorText(e)}`);
    }
  }
}

/** PayPal's word on a payout in progress, from the watcher or the regular poll. */
function applyPayoutStatus(draw: Draw, st: PayoutStatus) {
  if (draw.status !== 'processing') return;
  const name = store.member(draw.memberId).callName;
  if (st.state === 'success') {
    settleDraw(draw, st.transactionId, st.payoutItemId);
  } else if (st.state === 'failed') {
    draw.status = 'failed';
    draw.failureReason = st.reason ?? st.itemStatus ?? st.batchStatus;
    store.setNotice('error', `The payout to ${name} failed: ${draw.failureReason}`);
    store.addMessage({
      thread: 'host',
      from: 'banker',
      kind: 'text',
      text: `PayPal couldn't pay ${name}'s draw: ${draw.failureReason}. Tell me when to try again, and I'll ask for your approval.`,
    });
  } else if (st.reason && draw.failureReason !== st.reason) {
    // Still pending, but PayPal says why (nobody has claimed it yet, for example). Tell the host once.
    draw.failureReason = st.reason;
    store.setNotice('info', `PayPal is holding ${name}'s payout: ${st.reason}`);
  }
}

function settleDraw(draw: Draw, transactionId?: string, payoutItemId?: string) {
  if (draw.status === 'paid') return;
  const m = store.member(draw.memberId);
  draw.status = 'paid';
  draw.paidAt = nowIso();
  draw.failureReason = undefined;
  draw.transactionId = transactionId;
  draw.payoutItemId = payoutItemId;
  store.log('paypal', `${money(draw.amount)} reached ${m.callName}'s PayPal${transactionId ? ` (transaction ${transactionId})` : ''}.`, transactionId);
  store.addMessage({
    thread: m.id,
    from: 'banker',
    kind: 'payout',
    text: say.payoutLanded(m, { week: draw.week, pot: money(draw.amount) }),
    data: { amount: draw.amount, week: draw.week, transactionId },
  });
  store.addMessage({
    thread: 'host',
    from: 'banker',
    kind: 'text',
    text: `Done. ${money(draw.amount)} reached ${m.callName}'s PayPal.${transactionId ? ` Transaction ${transactionId}.` : ''}`,
  });
}

// ---------------------------------------------------------------------------
// Swaps
// ---------------------------------------------------------------------------

export function requestSwap(
  requesterId: string,
  counterpartyId: string,
  reasonPublic: string,
  messageToCounterparty?: string,
): { ok: boolean; text: string; swap?: Swap } {
  const s = store.state;
  const requester = store.member(requesterId);
  const counterparty = store.member(counterpartyId);
  const fromWeek = drawWeekOf(s.circle, requesterId);
  const toWeek = drawWeekOf(s.circle, counterpartyId);
  if (toWeek >= fromWeek) return { ok: false, text: `${counterparty.callName} doesn't draw before ${requester.callName}.` };
  const option = findSwapOptions(s.circle, s.members, s.draws, requesterId).find((o) => o.counterpartyId === counterpartyId);
  if (!option) return { ok: false, text: `${counterparty.callName}'s week can't be swapped any more.` };
  if (!option.allowed) return { ok: false, text: option.why };

  for (const old of s.swaps) {
    if (old.requesterId === requesterId && old.status === 'pending') old.status = 'cancelled';
  }
  const swap: Swap = {
    id: newId('swp'),
    requesterId,
    counterpartyId,
    fromWeek,
    toWeek,
    reasonPublic: reasonPublic || 'a family emergency',
    status: 'pending',
    createdAt: nowIso(),
  };
  s.swaps.push(swap);
  const needBy = counterparty.goal.needBy;
  const newDate = weekDate(s.circle, fromWeek);
  const text =
    messageToCounterparty?.trim() ||
    say.swapAsk(counterparty, {
      requesterName: requester.callName,
      reason: swap.reasonPublic,
      week: toWeek,
      date: longDay(weekDate(s.circle, toWeek)),
      newWeek: fromWeek,
      newDate: longDay(newDate),
      spareDays: needBy ? daysBetween(newDate, needBy) : null,
      needBy: needBy ? shortDay(needBy) : null,
    });
  store.addMessage({ thread: counterparty.id, from: 'banker', kind: 'swap_request', text, data: { swapId: swap.id } });
  store.addMessage({
    thread: 'host',
    from: 'banker',
    kind: 'swap_update',
    text: `${requester.callName} asked to draw early (${swap.reasonPublic}). I've asked ${counterparty.callName} to swap Week ${toWeek} for Week ${fromWeek}. ${option.why}`,
    data: { swapId: swap.id },
  });
  store.log('banker', `Asked ${counterparty.callName} to swap Week ${toWeek} with ${requester.callName}'s Week ${fromWeek}.`);

  if (counterparty.swapPolicy === 'auto_if_no_harm' && option.harmDays === 0) {
    respondSwap(swap.id, true, 'agent');
  }
  return {
    ok: true,
    swap,
    text: `Asked ${counterparty.callName} (Week ${toWeek}, ${shortDay(weekDate(s.circle, toWeek))}) to swap with ${requester.callName}. ${option.why}`,
  };
}

export function respondSwap(swapId: string, accept: boolean, by: 'member' | 'agent' = 'member'): string {
  const s = store.state;
  const swap = s.swaps.find((x) => x.id === swapId);
  if (!swap) throw new Error('Unknown swap');
  if (swap.status !== 'pending') return `That swap was already ${swap.status}.`;
  const requester = store.member(swap.requesterId);
  const counterparty = store.member(swap.counterpartyId);
  swap.status = accept ? 'accepted' : 'declined';
  swap.decidedAt = nowIso();
  swap.decidedBy = by;
  const hostName = host().callName;

  if (!accept) {
    store.addMessage({
      thread: requester.id,
      from: 'banker',
      kind: 'swap_update',
      text: say.swapDeclinedRequester(requester, { counterpartyName: counterparty.callName, hostName }),
    });
    store.addMessage({
      thread: counterparty.id,
      from: 'banker',
      kind: 'swap_update',
      text: say.swapDeclinedCounterparty(counterparty, {
        week: swap.toWeek,
        date: longDay(weekDate(s.circle, swap.toWeek)),
      }),
    });
    store.log('member', `${counterparty.callName} declined the swap with ${requester.callName}.`);
    return 'Declined.';
  }

  // Apply: the requester takes the earlier week, the counterparty the later one.
  const order = s.circle.drawOrder;
  order[swap.toWeek - 1] = requester.id;
  order[swap.fromWeek - 1] = counterparty.id;
  const early = store.draw(swap.toWeek)!;
  const late = store.draw(swap.fromWeek)!;
  early.memberId = requester.id;
  late.memberId = counterparty.id;
  for (const a of s.approvals) {
    if (a.status === 'pending' && (a.week === swap.toWeek || a.week === swap.fromWeek)) a.status = 'superseded';
  }
  const ready = swap.toWeek === s.circle.currentWeek && handsFor(swap.toWeek).every((h) => h.status === 'paid');
  if (early.status === 'awaiting_approval' || (ready && early.status === 'collecting')) early.status = 'ready';

  store.log(
    'member',
    by === 'agent'
      ? `${counterparty.callName}'s agent accepted within their swap rules: ${requester.callName} now draws Week ${swap.toWeek}, ${counterparty.callName} Week ${swap.fromWeek}.`
      : `${counterparty.callName} agreed: ${requester.callName} now draws Week ${swap.toWeek}, ${counterparty.callName} Week ${swap.fromWeek}.`,
  );
  const needBy = counterparty.goal.needBy;
  const lateDate = weekDate(s.circle, swap.fromWeek);
  store.addMessage({
    thread: counterparty.id,
    from: 'banker',
    kind: 'swap_update',
    text: say.swapAcceptedCounterparty(counterparty, {
      week: swap.fromWeek,
      date: longDay(lateDate),
      spareDays: needBy ? daysBetween(lateDate, needBy) : null,
      needBy: needBy ? shortDay(needBy) : null,
    }),
  });
  store.addMessage({
    thread: requester.id,
    from: 'banker',
    kind: 'swap_update',
    text: say.swapAcceptedRequester(requester, {
      counterpartyName: counterparty.callName,
      week: swap.toWeek,
      date: longDay(weekDate(s.circle, swap.toWeek)),
      pot: money(early.amount),
      ready,
      hostName,
    }),
  });
  store.addMessage({
    thread: 'host',
    from: 'banker',
    kind: 'swap_update',
    text: `${counterparty.callName} agreed to swap. ${requester.callName} now draws Week ${swap.toWeek}; ${counterparty.callName} moves to Week ${swap.fromWeek}.`,
    data: { swapId: swap.id },
  });
  if (ready) requestPayout(swap.toWeek, `${requester.callName} has ${swap.reasonPublic}, and all ${handsFor(swap.toWeek).length} hands are in for Week ${swap.toWeek}.`);
  else checkDrawReady(s.circle.currentWeek);
  return `Swapped: ${requester.callName} now draws Week ${swap.toWeek}.`;
}

// ---------------------------------------------------------------------------
// Week and PayPal sync
// ---------------------------------------------------------------------------

export async function advanceWeek(): Promise<string> {
  const s = store.state;
  const { circle } = s;
  const draw = store.draw(circle.currentWeek);
  if (draw && draw.status !== 'paid') {
    return `Week ${circle.currentWeek}'s draw hasn't been paid yet, so the week can't close.`;
  }
  if (circle.currentWeek >= circle.memberIds.length) return 'That was the last week. The circle is complete.';
  circle.currentWeek += 1;
  const week = circle.currentWeek;
  for (const h of handsFor(week)) if (h.status === 'upcoming') h.status = 'due';
  store.log('host', `Week ${week} opened.`);
  await issueInvoices(week);
  if (stale(s)) return 'The demo was reset.';
  const r = recipientOf(week);
  const text = `Week ${week} is open. PayPal invoices are out for all ${circle.memberIds.length} hands, and ${r.callName} draws ${money(pot())} on ${longDay(weekDate(circle, week))}.`;
  store.addMessage({ thread: 'host', from: 'banker', kind: 'text', text });
  return text;
}

let refreshing = false;
export async function refreshFromPayPal(): Promise<string> {
  if (refreshing) return 'Already checking PayPal.';
  refreshing = true;
  const s = store.state;
  let paid = 0;
  try {
    for (const hand of s.hands.filter((h) => h.status === 'due' && h.invoiceId && !recordingCash.has(h.id))) {
      const st = await gateway.getInvoiceStatus(hand.invoiceId!);
      if (stale(s)) return 'The demo was reset.';
      if (st.state === 'paid' && !recordingCash.has(hand.id)) {
        markHandPaid(hand, st.method === 'cash' ? 'cash' : 'paypal');
        paid += 1;
      }
    }
    for (const draw of s.draws.filter((d) => d.status === 'processing' && d.payoutBatchId)) {
      const st = await gateway.getPayoutStatus(draw.payoutBatchId!);
      if (stale(s)) return 'The demo was reset.';
      applyPayoutStatus(draw, st);
    }
    return paid ? `PayPal shows ${paid} new payment${paid === 1 ? '' : 's'}.` : 'PayPal is up to date.';
  } catch (e) {
    const text = `Couldn't reach PayPal: ${errorText(e)}`;
    store.setNotice('error', text);
    return text;
  } finally {
    refreshing = false;
  }
}

/** Plain-language status for the AI banker and offline replies. */
export function statusFor(week = store.state.circle.currentWeek) {
  const s = store.state;
  const { circle } = s;
  return {
    circle: circle.name,
    hand: money(circle.handAmount),
    draw_amount: money(pot()),
    current_week: week,
    weeks_total: circle.memberIds.length,
    this_week: {
      week,
      draw_date: longDay(weekDate(circle, week)),
      recipient: recipientOf(week).callName,
      draw_status: store.draw(week)?.status,
      hands: handsFor(week).map((h) => ({
        member: store.member(h.memberId).callName,
        member_id: h.memberId,
        status: h.status,
        method: h.method ?? null,
        reminders_sent: h.remindersSent,
      })),
      summary: progressLine(week),
    },
    schedule: circle.drawOrder.map((id, i) => ({
      week: i + 1,
      date: longDay(weekDate(circle, i + 1)),
      member: store.member(id).callName,
      member_id: id,
      status: store.draw(i + 1)?.status,
    })),
    pending_swaps: s.swaps
      .filter((x) => x.status === 'pending')
      .map((x) => ({ requester: store.member(x.requesterId).callName, counterparty: store.member(x.counterpartyId).callName })),
    pending_approvals: s.approvals
      .filter((a) => a.status === 'pending')
      .map((a) => ({ member: store.member(a.memberId).callName, amount: money(a.amount), week: a.week })),
  };
}
