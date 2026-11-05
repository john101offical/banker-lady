// Banker Lady through OpenRouter: an OpenAI-compatible chat completions loop with tool calling.
// Docs: https://openrouter.ai/docs/api-reference/overview
import type Anthropic from '@anthropic-ai/sdk';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** A hung model must not leave a chat waiting forever; the offline rules take over instead. */
const TIMEOUT_MS = 60_000;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_details?: unknown;
}

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  siteUrl?: string;
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  tools: Anthropic.Tool[];
  runTool: (name: string, input: Record<string, any>) => Promise<unknown>;
  maxSteps?: number;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

type Connection = Pick<OpenRouterOptions, 'apiKey' | 'siteUrl'>;

async function post(o: Connection, body: Record<string, unknown>) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${o.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Banker Lady',
      ...(o.siteUrl ? { 'HTTP-Referer': o.siteUrl } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const why = data?.error?.message ?? res.statusText ?? 'unknown error';
    throw new OpenRouterError(`OpenRouter ${res.status}: ${why}`, res.status);
  }
  const choice = data?.choices?.[0];
  if (!choice) throw new OpenRouterError('OpenRouter returned no answer');
  if (choice.error) throw new OpenRouterError(`OpenRouter: ${choice.error.message ?? 'model error'}`);
  return choice as { message: ChatMessage & { tool_calls?: ToolCall[] }; finish_reason?: string };
}

async function complete(o: OpenRouterOptions, messages: ChatMessage[]) {
  return post(o, {
    model: o.model,
    messages,
    tools: o.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    tool_choice: 'auto',
    max_tokens: 1500,
  });
}

export interface JsonRequest extends Connection {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

/** One question, answered as JSON that fits the schema. The caller still validates what it means. */
export async function openRouterJson(o: JsonRequest): Promise<unknown> {
  const choice = await post(o, {
    model: o.model,
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: o.schema } },
    // Only use a provider that really enforces the schema.
    provider: { require_parameters: true },
    max_tokens: o.maxTokens,
  });
  if (choice.finish_reason === 'length') throw new OpenRouterError('The model ran out of room before finishing its answer.');
  const content = typeof choice.message?.content === 'string' ? choice.message.content.trim() : '';
  try {
    return JSON.parse(content);
  } catch {
    throw new OpenRouterError('The model did not answer in the expected form.');
  }
}

/** Runs the tool loop until the model answers in words. Returns that answer. */
export async function openRouterReply(o: OpenRouterOptions): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'system', content: o.system }, ...o.history];
  for (let step = 0; step < (o.maxSteps ?? 8); step++) {
    const choice = await complete(o, messages);
    const msg = choice.message ?? { role: 'assistant', content: '' };
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      return (typeof msg.content === 'string' ? msg.content : '').trim() || 'Done.';
    }
    // Send the assistant turn back exactly as given, so the model keeps its own reasoning.
    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: calls,
      ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}),
    });
    for (const call of calls) {
      let content: string;
      try {
        const input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        const out = await o.runTool(call.function.name, input);
        content = JSON.stringify(out ?? { ok: true });
      } catch (e) {
        content = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return "I've done what I can for now. Ask me again if anything is still open.";
}
