// Walks the demo script end to end against the mock gateway and offline banker.
// Run with: npm test
import assert from 'node:assert/strict';

process.env.PAYPAL_CLIENT_ID = '';
process.env.ANTHROPIC_API_KEY = '';

const { buildDemoScene, loadScene } = await import('./seed.js');
const actions = await import('./actions.js');
const { bankerRespond } = await import('./banker/agent.js');
const { store } = await import('./store.js');

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

console.log('\nActivity (newest first):');
for (const a of store.state.activity.slice(0, 14)) console.log(` - [${a.kind}] ${a.text}`);
console.log('\nAll checks passed.');
process.exit(0);
