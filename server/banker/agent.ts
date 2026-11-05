// Banker Lady's brain: a model with tools (through OpenRouter or the Anthropic API),
// falling back to offline rules when no key is set.
import Anthropic from '@anthropic-ai/sdk';
import type { Member, Message } from '../../shared/types.js';
import { statusFor } from '../actions.js';
import { aiProvider, config, hasClaude } from '../config.js';
import { weekDate } from '../domain/circle.js';
import { longDay } from '../domain/dates.js';
import { store } from '../store.js';
import { offlineReply } from './offline.js';
import { openRouterReply } from './openrouter.js';
import { toolsFor, type Role } from './tools.js';

const client = hasClaude ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;
let fastSettings = true;

const LANGUAGE: Record<string, string> = {
  en: 'Write in clear, friendly English.',
  jm: "Write warm Jamaican English with a light, natural touch of Patois, the way a trusted Jamaican auntie texts (for example 'likkle', 'yuh', 'nuh worry', 'bless up'). Keep it easy to read and mirror how they write to you.",
  es: 'Write in warm, simple Spanish.',
  ht: 'Write in warm, simple Haitian Creole.',
};

function systemPrompt(role: Role, speaker: Member): string {
  const s = store.state;
  const c = s.circle;
  const n = c.memberIds.length;
  const who =
    role === 'host'
      ? `You are talking with ${speaker.name} ("${speaker.callName}"), who started this circle and is its host. The host approves every payout, records cash hands, and can ask you to remind members.`
      : `You are talking with ${speaker.name} ("${speaker.callName}"), a member, in their private chat. Their language code is "${speaker.language}". ${LANGUAGE[speaker.language] ?? LANGUAGE.en}`;
  return [
    `You are Banker Lady, the AI banker for "${c.name}", a partner: a rotating savings circle (also called susu, tanda or committee). ${n} members each throw a hand of $${c.handAmount} every week, and each week one member takes the whole draw of $${c.handAmount * n}. Real money moves through PayPal: every hand is a PayPal invoice (or cash recorded on that invoice), and every draw is paid with PayPal Payouts.`,
    who,
    `Today is in Week ${c.currentWeek}; this week's draw is on ${longDay(weekDate(c, c.currentWeek))}, which is ${weekDate(c, c.currentWeek)}. Tool dates use that year. Snapshot (use tools for anything that may have changed): ${JSON.stringify(statusFor())}`,
    `How you work:
- Warm, calm and brief: one to three short sentences, like a trusted auntie who keeps a tidy book. Address people by their call name.
- Facts come from tools. Never invent amounts, dates or statuses.
- The circle changes between messages: hands come in, draws swap. An earlier message that no longer matches was true when you wrote it, so give the current facts without apologising or correcting yourself.
- You never move money yourself. Hands are paid by members in PayPal, or recorded as cash only when the host says so. Draws are paid only after the host approves in the app.
- Nobody's draw week changes without their consent. For an emergency: update_need_date for the requester, then find_swap_options, choose the earliest option with allowed=true and harm_days=0, and request_swap with a kind message in that member's counterparty_language, even when it differs from the language of this chat. If no option is harmless, say so and suggest asking the host.
- Keep private details private. Other members learn only a general reason, such as "a family emergency".
- When someone is late, remind kindly. Never shame anyone about money.
- Explain decisions in plain words, with dates and amounts.
- Don't use Markdown formatting; your replies appear in a chat bubble.`,
  ].join('\n\n');
}

function describe(m: Message): string {
  const extra: Record<string, string> = {
    pay_request: ' [PayPal pay button attached]',
    swap_request: ' [Yes/No swap buttons attached]',
    payout: ' [payout notice]',
    approval: ' [Approve/Hold buttons attached]',
  };
  return `${m.voice ? '(voice note) ' : ''}${m.text}${extra[m.kind] ?? ''}`;
}

function history(thread: string): { role: 'user' | 'assistant'; content: string }[] {
  const msgs = store.state.messages.filter((m) => m.thread === thread).slice(-24);
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of msgs) {
    const role = m.from === 'banker' ? 'assistant' : 'user';
    const text = describe(m);
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role, content: text });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '(Earlier messages in this chat follow.)' });
  return out;
}

async function create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  if (!client) throw new Error('No Anthropic key');
  if (fastSettings) {
    try {
      return await client.messages.create({
        ...params,
        thinking: { type: 'between_tools' },
        output_config: { effort: 'medium' },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        fastSettings = false; // This model doesn't take those settings; use its defaults.
      } else {
        throw e;
      }
    }
  }
  return client.messages.create(params);
}

async function claudeReply(thread: string, role: Role, speaker: Member): Promise<string> {
  const tools = toolsFor(role);
  const convo: Anthropic.MessageParam[] = history(thread);
  const system = systemPrompt(role, speaker);
  for (let step = 0; step < 8; step++) {
    const res = await create({ model: config.anthropic.model, max_tokens: 1500, system, tools: tools.defs, messages: convo });
    if (res.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const out = await tools.run(block.name, block.input as Record<string, any>, { speakerId: speaker.id, role });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out ?? { ok: true }) });
        } catch (e) {
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: e instanceof Error ? e.message : String(e),
            is_error: true,
          });
        }
      }
      convo.push({ role: 'user', content: results });
      continue;
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || 'Done.';
  }
  return "I've done what I can for now. Ask me again if anything is still open.";
}

async function viaOpenRouter(thread: string, role: Role, speaker: Member): Promise<string> {
  const tools = toolsFor(role);
  return openRouterReply({
    apiKey: config.openrouter.apiKey,
    model: config.openrouter.model,
    siteUrl: config.openrouter.siteUrl,
    system: systemPrompt(role, speaker),
    history: history(thread),
    tools: tools.defs,
    runTool: (name, input) => tools.run(name, input, { speakerId: speaker.id, role }),
  });
}

/** Replies to the newest message in a thread. Runs in the background after a message is posted. */
export async function bankerRespond(thread: string): Promise<void> {
  const s = store.state;
  const role: Role = thread === 'host' ? 'host' : 'member';
  const speaker = store.member(role === 'host' ? s.circle.hostId : thread);
  const latest = [...s.messages].reverse().find((m) => m.thread === thread && m.from !== 'banker');
  if (!latest) return;
  store.setTyping(thread, true);
  try {
    let text: string;
    if (aiProvider !== 'offline') {
      try {
        text = aiProvider === 'openrouter' ? await viaOpenRouter(thread, role, speaker) : await claudeReply(thread, role, speaker);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        store.log('system', `The AI model was unavailable (${why.slice(0, 160)}); answered with offline rules.`);
        text = await offlineReply(thread, role, speaker, latest);
      }
    } else {
      await new Promise((r) => setTimeout(r, 700));
      text = await offlineReply(thread, role, speaker, latest);
    }
    if (store.state !== s) return;
    store.addMessage({ thread, from: 'banker', kind: 'text', text });
  } finally {
    store.setTyping(thread, false);
  }
}
