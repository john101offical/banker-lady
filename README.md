# Banker Lady

**An AI banker for partner, susu, tanda and committee: the savings circles families have run on trust for generations.**

Every week, each member of a partner "throws a hand" (a fixed amount) into the pot, and one member takes the whole "draw". It has paid for homes, school fees, nurse training and flights home for funerals. It also rests on one person, the banker, who keeps the book, chases late hands, juggles emergencies and holds the money. When that trust breaks, families lose everything.

Banker Lady keeps the warmth of the banker and removes the single point of failure:

- **Every hand is a PayPal invoice.** Members pay in PayPal; cash hands are recorded on the same invoice, so the book and PayPal never disagree.
- **Every draw is a PayPal Payout,** sent only after the host approves it. The AI never moves money on its own.
- **The draw order is fair by design.** Members say what they're saving for and when; Banker Lady orders the draws so everyone's money arrives before they need it, and new members draw only after paying in for a few weeks.
- **Emergencies get handled kindly.** When someone needs their draw early, Banker Lady finds a member who can swap without being hurt, asks them in their own language, and moves the draw only if they agree.
- **Reminders without shame,** in each member's language, including Jamaican Patois.
- **Private things stay private.** The circle sees a short label such as "family". The details stay between a member and the banker.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## The demo circle

The app starts in Week 3 of the Ward 4 Partner: six members, $50 a week, a $300 draw every Monday. Weeks 1 and 2 were imported from the host's paper partner book.

| Member | Saving for | Needs it by | Draws |
| --- | --- | --- | --- |
| Miss Joyce | A new fridge (pays cash) | Nov 20 | Week 1 |
| Andre | A barrel home for Christmas | Dec 8 | Week 2 |
| Kezia | January school fees | Jan 4 | Week 3 |
| Devon | Car repair (new to the circle) | Nov 23 | Week 4 |
| Miss P (host) | A land payment | Jan 15 | Week 5 |
| Marcia | Family (the rest is private) | no date | Week 6 |

Walk through it in about two minutes:

1. **Miss P's phone (host):** tap "Joyce gave me cash". Banker Lady records the cash on Joyce's PayPal invoice.
2. Tap "Remind Devon, kindly". Devon gets a warm reminder in Patois with a PayPal pay button, and PayPal sends its own invoice reminder.
3. **Devon's phone:** tap **Pay with PayPal**. All six hands are now in, and an approval appears for Kezia's draw.
4. **Marcia's phone:** her mother is in hospital. Send the suggested message (or record a voice note). Banker Lady finds that Kezia can swap Week 3 for Week 6 and still have her money 14 days before her fees are due, and asks her. Everyone else, Kezia and the host included, only ever sees "family emergency".
5. **Kezia's phone:** tap **Yes, swap**. The draw stamp moves in the book and the timeline.
6. **Approve payout** at the top. $300 lands in Marcia's PayPal.
7. Look at the **PayPal ledger**, **Activity** and **Who still owes** tabs.

**Reset demo** puts everything back.

## Start a new circle

Tap **Start a new circle** and describe it in your own words: names, the hand, what each person is saving for and by when, who is new, and who pays cash. The model fills in a form for you to check. Without an AI key, the form opens with the demo cast.

Banker Lady then works out the order and shows it in the book and the timeline with a reason for each draw. No PayPal invoice exists until you tap **Send the first invoices**.

## How PayPal is used

| What | PayPal API |
| --- | --- |
| A hand is due | Invoicing v2: create and send an invoice per member per week |
| A member pays | The member pays the invoice in PayPal; the app polls the invoice status |
| Cash handed to the host | Invoicing v2: record a payment with method `CASH` on that invoice |
| A late hand | Invoicing v2: send PayPal's invoice reminder, plus the banker's own message |
| A draw | Payouts v1: one payout to the member's PayPal, after the host approves |
| Settlement | Payouts v1: poll the batch until the item succeeds |

The code is in [`server/paypal/sandbox.ts`](server/paypal/sandbox.ts). Without keys, [`server/paypal/mock.ts`](server/paypal/mock.ts) simulates the same calls so the app runs anywhere.

## How AI is used

- **Claude as the banker** ([`server/banker/agent.ts`](server/banker/agent.ts)): every message from a member or the host goes to Claude Sonnet 5.5 through [OpenRouter](https://openrouter.ai) ([`server/banker/openrouter.ts`](server/banker/openrouter.ts)), with a set of tools ([`server/banker/tools.ts`](server/banker/tools.ts)): check the circle, find swap options, request a swap, record cash, send a reminder, ask the host to approve a payout. Members can only act for themselves; payouts only create an approval request. The Anthropic API works too, if you set an Anthropic key instead.
- **A fair draw order** ([`server/domain/circle.ts`](server/domain/circle.ts)): an assignment solver (the Hungarian algorithm) places draws so nobody is paid after their need date where avoidable, earlier needs get earlier weeks, and new members wait for the trust period. Each placement comes with a plain-language reason.
- **Private details stay with the banker:** a member's private detail never leaves the server. `/api/state` copies members field by field and carries only the viewer's own chat, and the model sees a private detail only when it's talking to that member. Swap requests use fixed wording, so the model can't pass on what it was told. `npm test` checks this over the real API. The demo has no sign-in, so anyone can still pick Marcia's phone from the list; a production version would add member sign-in.
- **Harmless swaps:** swap options are scored by how many days late the other member would become; the banker only proposes swaps that cost nobody anything.
- **Offline mode** ([`server/banker/offline.ts`](server/banker/offline.ts)): without an AI key, simple rules cover the demo using the same actions, so judges can run it with no keys at all. If the AI service is down, the banker falls back to these rules too.

## Sponsor tools

- **Bryntum Scheduler:** the draw timeline shows each member's need-by window as a green band and their draw on top, so you can see at a glance whether money arrives in time. Swaps animate on the timeline.
- **AG Grid:** the PayPal ledger lists every hand and draw with its PayPal invoice number, payout batch or transaction id, with sorting, filters and search. **Ask the ledger** turns a plain question such as "who paid cash?" into a real AG Grid filter. The model chooses from fixed columns and operators and the server writes the filter, so it can only ever filter. Without a key, keyword rules answer the everyday questions.
- **Render:** [`render.yaml`](render.yaml) deploys the whole app as one web service.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm run build
npm start          # http://localhost:8787
```

That runs with simulated PayPal and the offline banker. For development with hot reload: `npm run dev` (web on http://localhost:5173).

To check the whole demo flow from the command line: `npm test`. It also checks the OpenRouter tool loop against a scripted stand-in, so it needs no keys.

### With the PayPal sandbox and an AI key

Copy `.env.example` to `.env` and fill it in:

| Variable | What it's for |
| --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | A sandbox REST app from the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox). With these set, all money moves through the PayPal sandbox. |
| `SANDBOX_BUYER_EMAIL` | A sandbox personal account. Every member uses it unless set below. |
| `MEMBER_EMAILS` | Optional per-member sandbox accounts, e.g. `marcia=sb-1@personal.example.com,devon=sb-2@personal.example.com` |
| `OPENROUTER_API_KEY` | Turns on the AI banker through [OpenRouter](https://openrouter.ai/keys). |
| `OPENROUTER_MODEL` | Optional. Defaults to `anthropic/claude-sonnet-5.5`; `anthropic/claude-haiku-5.5` answers faster and costs less. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional alternative: call Claude directly instead of through OpenRouter. Used only when no OpenRouter key is set. |

Sandbox checklist:

- In the sandbox app's settings, make sure **Invoicing** and **Payouts** are enabled. A newly ticked feature can take a few minutes to reach your tokens; until then invoice calls return `403 NOT_AUTHORIZED`.
- `SANDBOX_BUYER_EMAIL` must be the sandbox **personal** account (`sb-...@personal.example.com`), not the business account that owns the app and not a real email. A payout to an address with no sandbox account stays `UNCLAIMED` and never reaches `SUCCESS`.
- The sandbox business account (the banker) needs a balance of at least $2,000 so payouts don't fail.
- To pay an invoice as a member, open **Pay with PayPal** and log in with the sandbox personal account.
- Restart the server after changing `.env`. Each start and each **Reset demo** creates a new set of invoices in the sandbox.

### Deploy on Render

Create a new **Blueprint** on Render from this repository. It reads `render.yaml`, asks for the environment variables above, and gives you a public URL.

## Project layout

```
server/
  index.ts            HTTP API, live updates (server-sent events), static web app
  actions.ts          everything that changes the circle; used by buttons, Claude and offline mode alike
  domain/circle.ts    draw order solver, swap options, risk
  paypal/             sandbox (real REST calls) and mock gateways
  banker/             Claude agent, tools, offline rules, message templates
  seed.ts             the demo circle
shared/types.ts       types shared by server and web
web/src/              React app: the book, phones, Bryntum timeline, AG Grid ledger
```

State is kept in memory and reseeded on start, which suits a demo. A production version would add a database, member sign-in, and PayPal webhooks in place of polling.

## Licenses

Banker Lady is MIT licensed (see [LICENSE](LICENSE)). Bryntum Scheduler is commercial software; this repo uses the public trial package, which shows a watermark. AG Grid Community is MIT licensed. Fonts: Atkinson Hyperlegible Next and Caveat, both under the SIL Open Font License.
