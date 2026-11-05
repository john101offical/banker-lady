// The app runs on a public URL with no sign-in, so these keep a stranger from running up the
// AI bill or hammering the PayPal sandbox. Going over never breaks the demo: the offline banker answers.
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { store } from './store.js';

/** Lets one visitor make at most `perMinute` requests a minute. */
export function perVisitor(perMinute: number) {
  const seen = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (seen.get(key) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= perMinute) {
      res.status(429).json({ error: "That's a lot of requests at once. Give it a minute and try again." });
      return;
    }
    recent.push(now);
    if (seen.size > 10_000) seen.clear();
    seen.set(key, recent);
    next();
  };
}

/** A ceiling on AI calls per UTC day for the whole app. onSpent runs once a day, the first time it's reached. */
export function dailyBudget(limit: number, onSpent: () => void, today = () => new Date().toISOString().slice(0, 10)) {
  let day = '';
  let used = 0;
  return {
    take(): boolean {
      if (today() !== day) {
        day = today();
        used = 0;
      }
      if (used === limit) onSpent();
      used += 1;
      return used <= limit;
    },
  };
}

export const aiBudget = dailyBudget(config.aiDailyLimit, () =>
  store.log('system', `Today's limit of ${config.aiDailyLimit} AI calls is used up, so Banker Lady is using its offline rules until tomorrow.`),
);
