// Walks the demo script end to end against the mock gateway and offline banker.
// Run with: npm test
import assert from 'node:assert/strict';

process.env.PAYPAL_CLIENT_ID = '';
process.env.ANTHROPIC_API_KEY = '';

const { buildDemoScene, loadScene } = await import('./seed.js');
const actions = await import('./actions.js');
const { bankerRespond } = await import('./banker/agent.js');
const { store } = await import('./store.js');
const { gateway } = await import('./paypal/index.js');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, label: string, ms = 8000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for: ${label}`);
    await wait(50);
  }
}
const say = async (thread: string, text: string, voice = false) => {
  store.addMessage({ thread, from: thread === 'host' ? 'host' : 'member', kind: 'text', text, voice });
  await bankerRespond(thread);
};
const lastBanker = (thread: string) =>
  [...store.state.messages].reverse().find((m) => m.thread === thread && m.from === 'banker')?.text;

// 1. The optimizer reproduces the draw order in the demo script.
const { state } = buildDemoScene();
assert.deepEqual(state.circle.drawOrder, ['joyce', 'andre', 'kezia', 'devon', 'pauline', 'marcia']);
console.log('✓ draw order', state.circle.drawOrder.join(' → '));

// 2. Week 3 loads with invoices; four hands seeded as paid.
await loadScene('demo');
const W = 3;
const wk = () => store.state.hands.filter((h) => h.week === W);
assert.equal(wk().filter((h) => h.status === 'paid').length, 4);
assert.ok(wk().every((h) => h.invoiceId));
console.log('✓ week 3 invoices', wk().map((h) => `${h.memberId}:${h.status}`).join(' '));

// 3. Host nudges Devon; Devon gets a Patois reminder with a pay button.
await say('host', 'Please remind Devon about his hand');
assert.equal(store.hand('devon', W)!.remindersSent, 1);
console.log('✓ reminder →', lastBanker('devon'));

// 4. Joyce pays cash; Devon pays in PayPal; the draw becomes ready and an approval appears for Kezia.
await say('host', 'Joyce gave me cash');
assert.equal(store.hand('joyce', W)!.method, 'cash');
await actions.simulatePayPalPayment(store.hand('devon', W)!.id);
const approvalFor = (id: string) => store.state.approvals.find((a) => a.status === 'pending' && a.memberId === id);
assert.ok(approvalFor('kezia'), 'approval for Kezia');
console.log('✓ all hands in; approval pending for Kezia');

// 5. Marcia's emergency voice note → swap request to Kezia.
await say('marcia', 'Miss Banker, mi madda inna hospital. Mi can get mi draw early?', true);
const swap = store.state.swaps.find((x) => x.status === 'pending');
assert.equal(swap?.counterpartyId, 'kezia');
console.log('✓ banker →', lastBanker('marcia'));
console.log('✓ kezia sees →', lastBanker('kezia'));

// 6. Kezia accepts; order swaps; approval moves to Marcia.
actions.respondSwap(swap!.id, true);
assert.deepEqual(store.state.circle.drawOrder, ['joyce', 'andre', 'marcia', 'devon', 'pauline', 'kezia']);
const approval = approvalFor('marcia');
assert.ok(approval, 'approval for Marcia');
assert.ok(!approvalFor('kezia'));
console.log('✓ swapped; approval pending for Marcia');

// 7. Host approves; the payout settles; Marcia is told.
await actions.decideApproval(approval!.id, true);
await until(() => store.draw(W)!.status === 'paid', 'payout to settle');
console.log('✓ payout →', lastBanker('marcia'));

// 8. Risk shows money owed by members who already drew.
const snap = store.snapshot();
console.log('✓ risk', snap.risk.exposure, '-', snap.risk.note);
console.log('✓ plan', snap.plan.map((p) => `W${p.week} ${p.memberId}: ${p.reason}`).join('\n         '));

// 9. Next week opens with new invoices.
console.log('✓ advance →', await actions.advanceWeek());
assert.equal(store.state.circle.currentWeek, 4);

// 10. PayPal holds a payout, then fails it: the host is told each time and can ask again.
await loadScene('demo');
await actions.recordCash('joyce');
await actions.simulatePayPalPayment(store.hand('devon', W)!.id);
const settled = gateway.getPayoutStatus.bind(gateway);
const held = 'The receiver has no PayPal account for that email yet.';
gateway.getPayoutStatus = async (batchId) => ({ batchId, state: 'pending', batchStatus: 'SUCCESS', itemStatus: 'UNCLAIMED', reason: held });
await actions.decideApproval(approvalFor('kezia')!.id, true);
await until(() => store.notice?.text.includes(held) ?? false, 'held payout notice');
assert.equal(store.draw(W)!.status, 'processing');
gateway.getPayoutStatus = async (batchId) => ({ batchId, state: 'failed', batchStatus: 'SUCCESS', itemStatus: 'FAILED', reason: 'Receiver blocked' });
await until(() => store.draw(W)!.status === 'failed', 'failed payout');
assert.match(store.notice?.text ?? '', /Receiver blocked/);
gateway.getPayoutStatus = settled;
actions.requestPayout();
await actions.decideApproval(approvalFor('kezia')!.id, true);
await until(() => store.draw(W)!.status === 'paid', 'retried payout to settle');
assert.equal(store.draw(W)!.failureReason, undefined);
console.log('✓ held and failed payouts are reported; the retry settles');

// 11. The PayPal poll landing mid-cash doesn't report the hand twice.
await loadScene('demo');
const thanks = () => store.state.messages.filter((m) => m.thread === 'joyce' && m.from === 'banker' && /cash|PayPal/.test(m.text)).length;
const before = thanks();
// PayPal has marked the invoice paid, but its answer hasn't reached us yet: that's when the poll could double-report.
const recordPayment = gateway.recordPayment.bind(gateway);
gateway.recordPayment = async (id, payment) => {
  await recordPayment(id, payment);
  await wait(300);
};
const cash = actions.recordCash('joyce');
await wait(500);
await actions.refreshFromPayPal();
await cash;
gateway.recordPayment = recordPayment;
assert.equal(thanks(), before + 1);
console.log('✓ cash recorded once when the poll overlaps it');

console.log('\nActivity (newest first):');
for (const a of store.state.activity.slice(0, 14)) console.log(` - [${a.kind}] ${a.text}`);
console.log('\nAll checks passed.');
process.exit(0);
