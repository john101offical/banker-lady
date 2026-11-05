# Banker Lady: notes for Claude Code

PayPal AI Hackathon entry. Deadline: Thursday Nov 12, 2026, 3:00pm EST (same as Jamaica time).
Banker Lady is an AI banker for partner (susu, tanda, committee) savings circles: every hand is a PayPal invoice, every draw is a PayPal Payout approved by the host, and Claude handles the banker's judgment work (draw order, swaps, reminders).

## Commands

- `npm install`
- `npm run dev` runs the server on :8787 and the web app on :5173 with hot reload
- `npm run build` builds the web app into `dist/web`; `npm start` serves everything on :8787
- `npm test` walks the whole demo script against mock PayPal and the offline banker, then checks the OpenRouter tool loop against a scripted stand-in; it must keep passing. It blanks every key itself, so it costs nothing and never touches real services, even with a full `.env`
- `npm run typecheck` checks the server; `npx tsc --noEmit -p web/tsconfig.json` checks the web app

## Map

- `server/actions.ts`: every change to the circle goes through here (invoices, cash, reminders, swaps, approvals, payouts, week changes). Buttons, Claude's tools and offline mode all call these same functions.
- `server/domain/circle.ts`: draw-order solver (Hungarian algorithm), plain-language reasons, swap options with `harmDays`, risk.
- `server/paypal/sandbox.ts`: real PayPal REST calls (Invoicing v2, Payouts v1). `mock.ts` simulates them when no keys are set.
- `server/banker/agent.ts`: picks the brain. With `OPENROUTER_API_KEY` set it uses `openrouter.ts` (OpenAI-compatible chat completions with tool calling, model from `OPENROUTER_MODEL`, default `anthropic/claude-sonnet-5.5`). Otherwise, with `ANTHROPIC_API_KEY`, it calls the Anthropic SDK directly. Don't send `temperature` to Claude Sonnet 5.5; the API rejects it. `tools.ts` lists the tools and which role (host or member) may use each. `offline.ts` is the no-key fallback and the fallback when the AI call fails. `templates.ts` holds fixed wording, including Jamaican Patois.
- `server/domain/setup.ts` and `server/banker/setup.ts`: "Start a new circle". The model reads the host's words through `response_format` into a form; `cleanDraft` checks everything, whoever wrote it. Claude's structured outputs reject `minimum`, `maxLength` and similar, and need `additionalProperties: false` on every object, so limits live in `cleanDraft`.
- `server/seed.ts`: the demo circle (Ward 4 Partner, Week 3), and new circles as drafts. A draft (`circle.phase`) shows its order and reasons with no PayPal invoices; only `startCircle` sends them.
- `shared/types.ts`: types used by both server and web.
- `web/src/`: React app. `Book.tsx` is the partner book grid, `Phone.tsx` the member and host phones, `Timeline.tsx` the Bryntum Scheduler, `Ledger.tsx` the AG Grid ledger.

## Rules

- The AI never moves money. Payouts only create an approval that the host taps; keep it that way.
- Members can only act for themselves; enforce it in the tool layer, not just the prompt.
- Keep mock PayPal and the offline banker working: judges may run the app with no keys.
- Never commit secrets. Keys live in `.env` locally and in Render's environment settings.
- Keep a member's private reasons private: others only hear "a family emergency". A goal has a public `label` and a server-only `privateDetail` (on `ServerMember` in `store.ts`, so the web types can't even name it). `store.snapshot(viewer)` copies members field by field and sends only the viewer's own chat, and the model sees a private detail only in that member's own chat. Swap requests use fixed wording with no text from the model, so nothing it read can reach another member. `npm test` checks all of this over the real API.
- UI copy is plain and sentence case. Colours and fonts are CSS variables at the top of `web/src/styles.css` (ballpoint ink on a ruled exercise book, violet stamps for draws).
- After changes: `npm test`, both type checks, and a screenshot of the running app to check the UI.

## Demo story (keep it working)

Week 3 of six, $50 hands, $300 draws. Miss Joyce pays cash, Devon is late and gets a Patois reminder, Devon pays in PayPal, Marcia's mother is in hospital so she asks to draw early (the circle only ever sees "family", then "family emergency"), Kezia (Week 3, fees due Jan 4) swaps to Week 6 without harm, Miss P approves, and Marcia's $300 Payout lands.

## Not built yet

- "Ask the ledger": plain-English questions turned into AG Grid filters.
- PayPal webhooks instead of polling; a database instead of in-memory state.
