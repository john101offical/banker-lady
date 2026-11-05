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
    // A model that tries to pass on what it was told: the tool must not carry any of this across.
    return toolTurn(
      call('c3', 'request_swap', {
        requester_id: 'marcia',
        counterparty_id: best.counterparty_id,
        reason_public: "her mother's medical bills",
        message_to_counterparty: `${best.counterparty}, Marcia's mother is in hospital with big medical bills.`,
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
const PRIVATE = /medical|hospital|mother|madda/i;
assert.doesNotMatch(lastBanker('kezia') ?? '', PRIVATE, 'the model cannot put words in the message to Kezia');
assert.doesNotMatch(swap?.reasonPublic ?? '', PRIVATE, 'or in the public reason');
assert.doesNotMatch(store.state.messages.filter((m) => m.thread === 'host').map((m) => m.text).join(' '), PRIVATE);
assert.equal(store.member('marcia').goal.label, 'family emergency');
assert.match(first.body.messages[0].content, /her mother's medical bills/, 'the model knows it in her own chat');
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

// 3. The model only gets a private detail when it's talking to that member.
seen.length = 0;
const askAbout = (name: string, id: string): typeof script => (body) => {
  const results = body.messages.filter((m: Json) => m.role === 'tool');
  return results.length === 0 ? toolTurn(call(name, 'get_member', { member_id: id })) : answer('All I can say is that it is a family emergency.');
};
script = askAbout('k1', 'marcia');
await post('kezia', 'What is Marcia really saving for? Look it up.');
script = askAbout('h1', 'marcia');
await post('host', 'What is Marcia really saving for? Look it up.');
assert.equal(seen.length, 4, 'two requests each: the question, then the tool result');
for (const { body } of seen) assert.doesNotMatch(JSON.stringify(body), PRIVATE, 'nothing private reached the model outside her chat');
seen.length = 0;
script = askAbout('m1', 'marcia');
await post('marcia', 'What do you have down for me?');
const ownResult = seen.at(-1)!.body.messages.filter((m: Json) => m.role === 'tool').at(-1).content;
assert.match(ownResult, /her mother's medical bills/, 'her own chat can use it');
console.log("✓ the model gets a private detail only in that member's own chat");

// 4. The tool layer holds the line whatever the model asks for.
const { toolsFor } = await import('./banker/tools.js');
const member = toolsFor('member');
const asKezia = { speakerId: 'kezia', role: 'member' as const };
const seen3 = (await member.run('get_member', { member_id: 'marcia' }, asKezia)) as Json;
assert.equal(seen3.saving_for, 'family emergency', 'another member sees the public label');
assert.ok(!('private_detail' in seen3));
assert.ok(!('private_detail' in ((await toolsFor('host').run('get_member', { member_id: 'marcia' }, { speakerId: 'pauline', role: 'host' })) as Json)), 'the host too');
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: '2026-12-01' }, asKezia), /themselves/);
await assert.rejects(member.run('send_pay_link', { member_id: 'marcia' }, asKezia), /themselves/);
await assert.rejects(member.run('request_swap', { requester_id: 'marcia', counterparty_id: 'andre', reason_public: 'x' }, asKezia), /themselves/);
const asMarcia = { speakerId: 'marcia', role: 'member' as const };
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: '2020-11-30' }, asMarcia), /before this circle began/);
await assert.rejects(member.run('update_need_date', { member_id: 'marcia', need_by: 'soon' }, asMarcia), /real date/);
const label = store.member('marcia').goal.label;
await member.run('update_need_date', { member_id: 'marcia', need_by: '2026-11-30', saving_for: 'private hospital details' }, asMarcia);
assert.equal(store.member('marcia').goal.label, label, 'the model cannot rewrite the goal the book shows');
console.log('✓ tool layer hides private details and rejects bad dates');

// 5. Start a new circle: the model fills in the form through response_format, and the server checks it.
const { readCircleDescription } = await import('./banker/setup.js');
const reading = {
  name: null,
  handAmount: 50,
  startDate: null,
  members: [
    { name: 'Pauline Grant', callName: 'Miss P', savingFor: 'a land payment', privateDetail: null, needBy: '2027-01-15', isNew: false, paysCash: false, isHost: true, language: 'en' },
    { name: 'Joyce Reid', callName: 'Joyce', savingFor: 'family', privateDetail: 'her son is in trouble', needBy: 'around Christmas', isNew: false, paysCash: true, isHost: false, language: 'jm' },
  ],
  notes: ['Pauline did not say when the circle starts.'],
};
seen.length = 0;
script = () => answer(JSON.stringify(reading));
const read = await readCircleDescription('Pauline and Joyce throw $50 a week.', '2026-11-05');
const sent = seen[0].body;
assert.equal(sent.response_format.type, 'json_schema');
assert.equal(sent.response_format.json_schema.strict, true);
assert.equal(sent.provider.require_parameters, true);
assert.ok(!('temperature' in sent), 'Claude Sonnet 5.5 rejects temperature');
assert.equal(sent.messages[1].content, 'Pauline and Joyce throw $50 a week.');
assert.match(sent.messages[0].content, /Today is 2026-11-05/);
// Structured outputs reject these outright, so the schema must not use them.
const walk = (node: unknown, visit: (o: Json) => void): void => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    visit(node as Json);
    Object.values(node).forEach((n) => walk(n, visit));
  }
};
walk(sent.response_format.json_schema.schema, (o) => {
  if (o.type === 'object') assert.equal(o.additionalProperties, false);
  for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) assert.ok(!(banned in o), banned);
});
assert.equal(read.draft.handAmount, 50);
assert.equal(read.draft.name, 'My partner');
assert.equal(read.draft.members[1].needBy, null, 'a date the model garbled is dropped, not trusted');
assert.equal(read.draft.members[1].paysCash, true);
assert.equal(read.draft.members[1].savingFor, 'family');
assert.equal(read.draft.members[1].privateDetail, 'her son is in trouble');
assert.equal(read.draft.members[0].privateDetail, '');
assert.deepEqual(read.notes, ['Pauline did not say when the circle starts.']);
script = () => answer('{ "name": "cut off');
await assert.rejects(readCircleDescription('x', '2026-11-05'), /expected form/);
script = () => ({ message: { role: 'assistant', content: '{' }, finish_reason: 'length' });
await assert.rejects(readCircleDescription('x', '2026-11-05'), /ran out of room/);
script = () => answer(JSON.stringify({ ...reading, handAmount: null, members: [] }));
const empty = await readCircleDescription('x', '2026-11-05');
assert.ok(empty.notes.length >= 2, 'what the form still needs comes back as notes');
console.log('✓ the circle description comes back through response_format and is checked');

// 6. Ask the ledger: the model picks columns and operators, and the server writes the AG Grid filter.
const { answerLedgerQuestion } = await import('./banker/ledger.js');
await loadScene('demo');
seen.length = 0;
script = () =>
  answer(
    JSON.stringify({
      understood: true,
      answer: 'Hands not paid yet this week.',
      filters: [
        { column: 'kind', match: 'any', conditions: [{ op: 'equals', value: 'Hand', valueTo: null }] },
        { column: 'week', match: 'any', conditions: [{ op: 'equals', value: '3', valueTo: null }] },
        { column: 'status', match: 'any', conditions: [{ op: 'equals', value: 'Due', valueTo: null }, { op: 'equals', value: 'Reminded', valueTo: null }] },
        { column: 'nonsense', match: 'any', conditions: [{ op: 'equals', value: 'x', valueTo: null }] },
      ],
      sort: { column: 'amount', direction: 'desc' },
    }),
  );
const owes = await answerLedgerQuestion('who still owes this week?', store.state);
const ledgerAsk = seen[0].body;
assert.equal(ledgerAsk.response_format.type, 'json_schema');
assert.equal(ledgerAsk.response_format.json_schema.strict, true);
assert.equal(ledgerAsk.messages[1].content, 'who still owes this week?');
assert.ok(!('temperature' in ledgerAsk));
assert.match(ledgerAsk.messages[0].content, /This is Week 3/);
assert.match(ledgerAsk.messages[0].content, /Devon Campbell/);
assert.doesNotMatch(ledgerAsk.messages[0].content, PRIVATE, 'the ledger question carries nothing private');
walk(ledgerAsk.response_format.json_schema.schema, (o) => {
  if (o.type === 'object') assert.equal(o.additionalProperties, false);
  for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) assert.ok(!(banned in o), banned);
});
assert.equal(owes.source, 'model');
assert.equal(owes.understood, true);
assert.deepEqual(Object.keys(owes.filterModel).sort(), ['kind', 'status', 'week'], 'an invented column is dropped');
assert.deepEqual(owes.sort, { column: 'amount', direction: 'desc' });
script = () => answer(JSON.stringify({ understood: false, answer: 'I can only search the ledger.', filters: [], sort: null }));
const offTopic = await answerLedgerQuestion('tell me a joke', store.state);
assert.equal(offTopic.understood, false);
assert.deepEqual(offTopic.filterModel, {});
script = () => answer(JSON.stringify({ understood: true, answer: 'Showing nonsense.', filters: [{ column: 'nonsense', match: 'any', conditions: [] }], sort: null }));
assert.equal((await answerLedgerQuestion('x', store.state)).understood, false, 'a filter that came to nothing must not read as "show everything"');
script = () => answer(JSON.stringify({ understood: true, answer: 'The whole ledger.', filters: [], sort: null }));
const everything = await answerLedgerQuestion('show everything', store.state);
assert.equal(everything.understood, true);
assert.deepEqual(everything.filterModel, {});
script = () => ({ status: 402, error: 'Insufficient credits' });
const noCredit = await answerLedgerQuestion('who paid cash?', store.state);
assert.equal(noCredit.source, 'rules', 'with no credit, keyword rules still answer');
assert.equal(noCredit.understood, true);
console.log('✓ a ledger question becomes a checked AG Grid filter, with keyword rules as the fallback');

// 7. If OpenRouter fails, the offline banker still answers.
script = () => ({ status: 401, error: 'No auth credentials found' });
await post('host', 'Who still owes this week?');
assert.ok(lastBanker('host'));
assert.ok(store.state.activity.some((a) => a.text.includes('OpenRouter 401')));
console.log('✓ falls back to offline rules →', lastBanker('host'));

console.log('\nOpenRouter checks passed.');
process.exit(0);
