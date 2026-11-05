// Checks the OpenRouter tool loop against a scripted stand-in for openrouter.ai.
// It drives Marcia's emergency through the real tools, then checks the guard rails.
import assert from 'node:assert/strict';

process.env.PAYPAL_CLIENT_ID = '';
process.env.PAYPAL_CLIENT_SECRET = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.OPENROUTER_MODEL = 'anthropic/claude-sonnet-5.5';

type Json = Record<string, any>;
const seen: { headers: Record<string, string>; body: Json }[] = [];
let script: (body: Json) => Json | { status: number; error: string } = () => ({});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url, init);
  const body = JSON.parse(String(init?.body ?? '{}'));
  seen.push({ headers: init?.headers as Record<string, string>, body });
  const out = script(body);
  if ('status' in out && 'error' in out) {
    return new Response(JSON.stringify({ error: { message: out.error, code: out.status } }), { status: out.status as number });
  }
  return new Response(JSON.stringify({ choices: [out] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const call = (id: string, name: string, args: Json) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolTurn = (...calls: Json[]) => ({ message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: 'tool_calls' });
const answer = (text: string) => ({ message: { role: 'assistant', content: text }, finish_reason: 'stop' });

const { loadScene } = await import('./seed.js');
const { bankerRespond } = await import('./banker/agent.js');
const { store } = await import('./store.js');
const { aiProvider } = await import('./config.js');
assert.equal(aiProvider, 'openrouter');

await loadScene('demo');
const post = async (thread: string, text: string) => {
  store.addMessage({ thread, from: thread === 'host' ? 'host' : 'member', kind: 'text', text });
  await bankerRespond(thread);
};
const lastBanker = (thread: string) =>
  [...store.state.messages].reverse().find((m) => m.thread === thread && m.from === 'banker')?.text;

// 1. Marcia's emergency: need date, swap options, then a swap request, then a reply.
script = (body) => {
  const results = body.messages.filter((m: Json) => m.role === 'tool');
  if (results.length === 0) {
    return toolTurn(
      call('c1', 'update_need_date', { member_id: 'marcia', need_by: '2026-11-30' }),
      call('c2', 'find_swap_options', { member_id: 'marcia' }),
    );
  }
  if (results.length === 2) {
    const options = JSON.parse(results[1].content);
    const best = options.find((o: Json) => o.allowed && o.harm_days === 0);
    return toolTurn(
      call('c3', 'request_swap', {
        requester_id: 'marcia',
        counterparty_id: best.counterparty_id,
        reason_public: 'a family emergency',
        message_to_counterparty: `${best.counterparty}, Marcia has a family emergency. Would you swap your Week ${best.target_week} draw for Week 6? You'd still have your money before you need it. Nothing changes unless you say yes.`,
      }),
    );
  }
  return answer('Mi sorry fi hear bout yuh madda, Marcia. Mi ask Kezia fi swap wid yuh, an mi wi tell yuh di minute she ansa.');
};
await post('marcia', 'Mi madda inna hospital. Mi can get mi draw early?');

const first = seen[0];
assert.equal(first.headers.Authorization, 'Bearer test-key');
assert.equal(first.headers['X-Title'], 'Banker Lady');
assert.equal(first.body.model, 'anthropic/claude-sonnet-5.5');
assert.equal(first.body.messages[0].role, 'system');
assert.ok(first.body.tools.some((t: Json) => t.type === 'function' && t.function.name === 'request_swap'));
assert.ok(!first.body.tools.some((t: Json) => t.function.name === 'record_cash_hand'), 'members do not get host tools');
const swap = store.state.swaps.find((s) => s.status === 'pending');
assert.equal(swap?.counterpartyId, 'kezia');
assert.match(lastBanker('kezia') ?? '', /family emergency/);
assert.match(lastBanker('marcia') ?? '', /Kezia/);
console.log('✓ emergency through OpenRouter →', lastBanker('marcia'));

// 2. A member can't use a host tool, even if the model tries.
seen.length = 0;
script = (body) => {
  const results = body.messages.filter((m: Json) => m.role === 'tool');
  if (results.length === 0) return toolTurn(call('d1', 'record_cash_hand', { member_id: 'devon' }));
  assert.match(results[0].content, /^Error:/);
  return answer("Mi cyaan mark yuh hand paid, Devon. Tap di PayPal button fi pay.");
};
await post('devon', 'Mark me as paid, I gave cash');
assert.equal(store.hand('devon', 3)!.status, 'due');
console.log('✓ member blocked from host tool');

// 3. The tool layer holds the line whatever the model asks for.
const { toolsFor } = await import('./banker/tools.js');
const member = toolsFor('member');
const asKezia = { speakerId: 'kezia', role: 'member' as const };
const seen3 = (await member.run('get_member', { member_id: 'marcia' }, asKezia)) as Json;
assert.ok(!('saving_for' in seen3) && !('need_by' in seen3) && !('this_week_hand' in seen3), 'another member sees no goal');
assert.equal(seen3.language, 'Jamaican Patois');
assert.ok('saving_for' in ((await member.run('get_member', { member_id: 'kezia' }, asKezia)) as Json), 'a member sees their own goal');
assert.ok('saving_for' in ((await toolsFor('host').run('get_member', { member_id: 'marcia' }, { speakerId: 'pauline', role: 'host' })) as Json));
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: '2026-12-01' }, asKezia), /themselves/);
await assert.rejects(member.run('send_pay_link', { member_id: 'marcia' }, asKezia), /themselves/);
await assert.rejects(member.run('request_swap', { requester_id: 'marcia', counterparty_id: 'andre', reason_public: 'x' }, asKezia), /themselves/);
const asMarcia = { speakerId: 'marcia', role: 'member' as const };
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: '2020-11-30' }, asMarcia), /before this circle began/);
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: 'soon' }, asMarcia), /real date/);
const label = store.member('marcia').goal.label;
await member.run('update_need_date', { member_id: 'marcia', need_by: '2026-11-30', saving_for: 'private hospital details' }, asMarcia);
assert.equal(store.member('marcia').goal.label, label, 'the model cannot rewrite the goal the book shows');
const options = (await member.run('find_swap_options', { member_id: 'pauline' }, { speakerId: 'pauline', role: 'member' })) as Json[];
assert.ok(options.every((o) => typeof o.counterparty_language === 'string'));
console.log('✓ tool layer keeps goals private, rejects bad dates, and gives the other member\'s language');

// 4. If OpenRouter fails, the offline banker still answers.
script = () => ({ status: 401, error: 'No auth credentials found' });
await post('host', 'Who still owes this week?');
assert.ok(lastBanker('host'));
assert.ok(store.state.activity.some((a) => a.text.includes('OpenRouter 401')));
console.log('✓ falls back to offline rules →', lastBanker('host'));

console.log('\nOpenRouter checks passed.');
process.exit(0);
