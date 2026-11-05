// Walks the demo script end to end against the mock gateway and offline banker.
// Run with: npm test
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

// Blank every key so a local .env can't send this test to real services.
process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.OPENROUTER_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { buildDemoScene, demoDraft, loadDraft, loadScene } = await import('./seed.js');
const { cleanDraft, memberId, nextMonday } = await import('./domain/setup.js');
const actions = await import('./actions.js');
const { bankerRespond } = await import('./banker/agent.js');
const { store } = await import('./store.js');
const { gateway } = await import('./paypal/index.js');
const { aiProvider } = await import('./config.js');
assert.equal(aiProvider, 'offline');
assert.equal(gateway.mode, 'mock');

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

// 12. A new circle: the draft is cleaned up whoever wrote it.
const TODAY = '2026-11-05';
assert.equal(nextMonday('2026-11-05'), '2026-11-09'); // a Thursday
assert.equal(nextMonday('2026-11-09'), '2026-11-16'); // a Monday means the next one
const person = (name: string, extra = {}) => ({ name, ...extra });
const tidy = cleanDraft(
  {
    handAmount: 25.555,
    startDate: '2026-02-31',
    members: [
      person('  Ana Lopez ', { isNew: true, needBy: '2026-13-01', language: 'klingon' }),
      person('Ana Lopez', { needBy: '2027-01-15' }),
      person(''),
      'not a person',
    ],
  },
  TODAY,
);
assert.deepEqual(tidy.problems, []);
assert.equal(tidy.draft.name, 'My partner');
assert.equal(tidy.draft.handAmount, 25.56);
assert.equal(tidy.draft.startDate, '2026-11-09', 'a date that does not exist falls back to next Monday');
assert.deepEqual(tidy.draft.members.map((m) => m.name), ['Ana Lopez', 'Ana Lopez 2']);
assert.equal(tidy.draft.members[0].needBy, null);
assert.equal(tidy.draft.members[0].language, 'en');
assert.deepEqual(tidy.draft.members.map((m) => m.isHost), [false, true], 'the first person who is not new hosts when nobody is named');
const twoHosts = cleanDraft({ handAmount: 5, members: [person('A', { isHost: true }), person('B', { isHost: true }), person('C')] }, TODAY);
assert.deepEqual(twoHosts.draft.members.map((m) => m.isHost), [true, false, false]);
assert.equal(cleanDraft({ handAmount: 5, members: [person('Solo')] }, TODAY).problems.length, 1);
assert.equal(cleanDraft({ handAmount: 5, members: Array.from({ length: 13 }, (_, i) => person(`P${i}`)) }, TODAY).problems.length, 1);
for (const hand of [0, -5, 'lots', null, 50_000]) {
  assert.equal(cleanDraft({ handAmount: hand, members: [person('A'), person('B')] }, TODAY).problems.length, 1, `hand ${hand}`);
}
const taken = new Set(['joyce']);
assert.equal(memberId('Joyce Reid', taken), 'joyce2');
assert.equal(memberId('Miss José Peña', new Set()), 'jose');
assert.equal(memberId('Host Person', new Set()), 'host2', 'the host console keeps its thread');
assert.equal(memberId('李', new Set()), 'member');
assert.ok(memberId('Bartholomew-Maximilian', new Set(['bartholo'])).length <= 10);
console.log('✓ drafts are cleaned up');

// 13. The order shows with its reasons before PayPal hears anything.
let invoicesCreated = 0;
const createAndSend = gateway.createAndSendInvoice.bind(gateway);
gateway.createAndSendInvoice = async (req) => {
  invoicesCreated += 1;
  return createAndSend(req);
};
loadDraft(demoDraft(TODAY));
const draftSnap = store.snapshot();
assert.equal(draftSnap.circle.phase, 'draft');
assert.deepEqual(draftSnap.circle.drawOrder, ['joyce', 'andre', 'kezia', 'devon', 'pauline', 'marcia'], 'same order as the demo');
assert.equal(draftSnap.plan.length, 6);
assert.match(draftSnap.plan.find((p) => p.memberId === 'devon')!.reason, /New to the circle/);
assert.ok(draftSnap.hands.every((h) => h.status === 'upcoming' && !h.invoiceId));
assert.match(await actions.recordCash('joyce'), /isn't due yet/);
assert.match(await actions.sendReminder('devon'), /isn't due yet/);
assert.match(await actions.advanceWeek(), /Send the first invoices/);
assert.match(actions.requestPayout(), /Not yet/);
await say('host', 'Joyce gave me cash');
assert.match(lastBanker('host') ?? '', /Nothing has gone to PayPal/);
await say('devon', 'How do I pay?');
assert.match(lastBanker('devon') ?? '', /Week 4/);
assert.equal(store.hand('joyce', 1)!.status, 'upcoming', 'the banker cannot record a hand in a draft');
assert.equal(invoicesCreated, 0, 'no invoices before the host confirms');
console.log('✓ a draft shows reasons and sends nothing →', draftSnap.plan[3].reason);

// 14. Only the host's tap sends them, and only once.
await Promise.all([actions.startCircle(), actions.startCircle()]);
assert.equal(invoicesCreated, 6);
assert.equal(store.state.circle.phase, 'running');
assert.ok(store.state.hands.filter((h) => h.week === 1).every((h) => h.status === 'due' && h.invoiceId));
assert.ok(store.state.hands.filter((h) => h.week > 1).every((h) => h.status === 'upcoming' && !h.invoiceId));
assert.match(await actions.startCircle(), /already started/);
gateway.createAndSendInvoice = createAndSend;
console.log('✓ first invoices →', lastBanker('host'));

// 15. A new circle runs the same way as the demo, whatever its size.
loadDraft(cleanDraft({ name: 'Trio', handAmount: 20, startDate: '2026-11-09', members: [person('Bea Ford', { isHost: true, needBy: '2026-11-10' }), person('Cy Hall', { needBy: '2026-11-20' }), person('Di New', { isNew: true, needBy: '2026-11-10' })] }, TODAY).draft);
assert.equal(store.state.circle.trustWeeks, 1);
assert.notEqual(store.state.circle.drawOrder[0], 'di', 'a new member still waits');
await actions.startCircle();
const first = store.state.circle.drawOrder[0];
for (const m of store.state.members) await actions.recordCash(m.id);
const trioApproval = store.state.approvals.find((a) => a.status === 'pending');
assert.equal(trioApproval?.memberId, first);
assert.equal(trioApproval?.amount, 60);
await actions.decideApproval(trioApproval!.id, true);
await until(() => store.draw(1)!.status === 'paid', 'trio payout');
console.log('✓ a three-person circle runs through to a payout:', store.state.circle.drawOrder.join(' → '));

// The demo still comes back afterwards.
await loadScene('demo');
assert.equal(store.state.circle.id, 'ward4');
assert.equal(store.state.circle.phase, 'running');

// 16. Marcia's details stay between her and the banker, checked over the real API.
const { app } = await import('./app.js');
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const DETAIL = "her mother's medical bills";
const PRIVATE = /medical|hospital|madda|mother|medicine/i;
const stateFor = async (viewer?: string) => (await fetch(`${base}/api/state${viewer ? `?viewer=${viewer}` : ''}`)).text();
const firstFrame = async (viewer: string) => {
  const res = await fetch(`${base}/api/stream?viewer=${viewer}`);
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
};
/** Everyone but Marcia: nobody's phone, the host, each other member, an unknown name, and the live stream. */
async function assertNothingLeaks(when: string) {
  const viewers = [undefined, 'host', 'not-a-member', ...store.state.members.filter((m) => m.id !== 'marcia').map((m) => m.id)];
  for (const viewer of viewers) {
    const text = await stateFor(viewer);
    assert.doesNotMatch(text, PRIVATE, `/api/state?viewer=${viewer} ${when}`);
    assert.doesNotMatch(text, /privateDetail|emergencyLine|"email"|@/, `server-only fields in /api/state?viewer=${viewer} ${when}`);
    const shown = JSON.parse(text);
    assert.ok(shown.messages.every((m: { thread: string }) => m.thread === viewer), `only their own chat for ${viewer} ${when}`);
  }
  assert.doesNotMatch(await firstFrame('kezia'), PRIVATE, `/api/stream ${when}`);
  assert.doesNotMatch(await firstFrame('host'), PRIVATE, `/api/stream ${when}`);
  for (const m of store.state.messages.filter((x) => x.thread !== 'marcia')) {
    assert.doesNotMatch(m.text, PRIVATE, `message in ${m.thread}'s chat ${when}`);
  }
}
assert.equal(store.member('marcia').goal.label, 'family');
assert.equal(store.member('marcia').privateDetail, DETAIL);
await assertNothingLeaks('at the start');
assert.doesNotMatch(await (await fetch(`${base}/api/setup/template`)).text(), PRIVATE, 'the form anyone can open');
assert.doesNotMatch(await (await fetch(`${base}/api/health`)).text(), PRIVATE);
const ownView = JSON.parse(await stateFor('marcia'));
assert.match(ownView.viewerLine, /hospital/, "Marcia's own phone suggests her own words");
assert.equal(JSON.parse(await stateFor('devon')).viewerLine, undefined, 'and nobody else gets them');

await actions.recordCash('joyce');
await actions.simulatePayPalPayment(store.hand('devon', W)!.id);
await say('marcia', `Mi madda inna hospital, is ${DETAIL}. Mi can get mi draw early?`);
const pending = store.state.swaps.find((x) => x.status === 'pending')!;
assert.equal(pending.reasonPublic, 'a family emergency');
assert.equal(store.member('marcia').goal.label, 'family emergency', 'her label now matches what Kezia is told');
assert.equal(store.member('marcia').privateDetail, DETAIL, 'and the banker still knows the rest');
assert.match(lastBanker('kezia') ?? '', /family emergency/);
assert.match(store.snapshot('kezia').plan.find((p) => p.memberId === 'marcia')!.reason, /^Family emergency/);
await assertNothingLeaks('after she asks');
assert.match(await stateFor('marcia'), /madda inna hospital/, 'her own phone still shows her own words');

actions.respondSwap(pending.id, true);
const moved = store.state.approvals.find((a) => a.status === 'pending' && a.memberId === 'marcia')!;
assert.match(moved.note, /family emergency/, 'the approval banner uses the public words');
assert.doesNotMatch(moved.note, PRIVATE);
await assertNothingLeaks('after the swap');
await actions.decideApproval(moved.id, true);
await until(() => store.draw(W)!.status === 'paid', 'payout to settle');
await assertNothingLeaks('after the payout');
console.log('✓ private details stay out of /api/state, the live stream and other members\' messages');

// A member with no private detail keeps what they were saving for, and the circle sees the same words.
await loadScene('demo');
const andreAsks = actions.requestSwap('pauline', 'andre');
assert.equal(andreAsks.ok, false, 'Week 2 is already paid');
const paulineAsks = actions.requestSwap('pauline', 'kezia');
assert.equal(paulineAsks.ok, true);
assert.equal(store.member('pauline').goal.label, 'family emergency');
assert.equal(store.member('pauline').privateDetail, 'a land payment');

// The swap request speaks every language the banker can, with no model involved.
const { say: words } = await import('./banker/templates.js');
const ask = { requesterName: 'Ana', reason: 'a family emergency', week: 3, date: 'Mon Nov 30', newWeek: 6, newDate: 'Mon Dec 21', spareDays: 14, needBy: 'Jan 4' };
const speaking = (language: 'en' | 'jm' | 'es' | 'ht') => words.swapAsk({ ...store.member('kezia'), language }, ask);
assert.match(speaking('en'), /family emergency/);
assert.match(speaking('jm'), /Nutten change/);
assert.match(speaking('es'), /emergencia familiar/);
assert.match(speaking('ht'), /ijans fanmi/);

// Private details typed into the form survive changing a draft, but don't carry over to a new circle.
const plan = (body: unknown) =>
  fetch(`${base}/api/setup/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const twoPeople = (privateDetail = '') => ({
  name: 'Two',
  handAmount: 10,
  members: [person('Ana Lopez', { savingFor: 'family', privateDetail }), person('Bea Ford', { savingFor: 'a stove' })],
});
assert.equal((await plan({ draft: twoPeople('a court case') })).status, 200);
assert.equal(store.member('ana').privateDetail, 'a court case');
assert.doesNotMatch(await stateFor('host'), /court case/);
assert.doesNotMatch(await stateFor(), /court case/);
assert.equal((await plan({ draft: twoPeople(), editing: true })).status, 200);
assert.equal(store.member('ana').privateDetail, 'a court case', 'a blank field keeps it when changing the draft');
assert.equal((await plan({ draft: twoPeople('a new detail'), editing: true })).status, 200);
assert.equal(store.member('ana').privateDetail, 'a new detail');
assert.equal((await plan({ draft: twoPeople() })).status, 200);
assert.equal(store.member('ana').privateDetail, undefined, 'a new circle starts clean');
server.close();
console.log('✓ the form keeps private details through a change, and a new circle starts clean');

console.log('\nActivity (newest first):');
for (const a of store.state.activity.slice(0, 14)) console.log(` - [${a.kind}] ${a.text}`);
console.log('\nAll checks passed.');
process.exit(0);
