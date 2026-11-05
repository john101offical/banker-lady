import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function parseEmails(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? '').split(',')) {
    const [id, email] = pair.split('=').map((s) => s?.trim());
    if (id && email) out[id.toLowerCase()] = email;
  }
  return out;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '',
  },
  /** OpenRouter (openrouter.ai): one key, many models. Used first when set. */
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? '',
    model: process.env.OPENROUTER_MODEL?.trim() || 'anthropic/claude-sonnet-5.5',
    /** Sent as HTTP-Referer for OpenRouter's app attribution. Render sets RENDER_EXTERNAL_URL itself. */
    siteUrl: process.env.PUBLIC_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? '',
    model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
  },
  /** Per-member PayPal emails, e.g. "marcia=sb-abc@personal.example.com,devon=sb-def@personal.example.com". */
  memberEmails: parseEmails(process.env.MEMBER_EMAILS),
  /** Fallback PayPal email for members without one (a sandbox personal account). */
  defaultMemberEmail: process.env.SANDBOX_BUYER_EMAIL?.trim() ?? '',
  /** AI calls allowed per day across the whole app, at roughly 3 cents each. */
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT) > 0 ? Number(process.env.AI_DAILY_LIMIT) : 150,
  /** How often to check PayPal for paid invoices and settled payouts, in sandbox mode. */
  pollSeconds: Number(process.env.PAYPAL_POLL_SECONDS ?? 8),
};

export const hasPayPal = Boolean(config.paypal.clientId && config.paypal.clientSecret);
export const hasOpenRouter = Boolean(config.openrouter.apiKey);
export const hasClaude = !hasOpenRouter && Boolean(config.anthropic.apiKey);

/** Which brain answers as Banker Lady. */
export const aiProvider: 'openrouter' | 'claude' | 'offline' = hasOpenRouter ? 'openrouter' : hasClaude ? 'claude' : 'offline';
export const aiModel = hasOpenRouter ? config.openrouter.model : hasClaude ? config.anthropic.model : undefined;
