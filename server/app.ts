import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as actions from './actions.js';
import { bankerRespond } from './banker/agent.js';
import { answerLedgerQuestion } from './banker/ledger.js';
import { readCircleDescription } from './banker/setup.js';
import { aiModel, aiProvider, hasOpenRouter } from './config.js';
import { cleanDraft } from './domain/setup.js';
import { aiBudget, perVisitor } from './limits.js';
import { gateway } from './paypal/index.js';
import { demoDraft, loadDraft, loadScene } from './seed.js';
import { store } from './store.js';

store.mode = {
  paypal: gateway.mode,
  ai: aiProvider,
  model: aiModel,
};

export const app = express();
// Render's proxy passes on the visitor's address. Someone could fake it, but the daily AI limit still holds.
app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

const anyChange = perVisitor(60);
const aiCall = perVisitor(20);
const sendsInvoices = perVisitor(6);
app.use('/api', (req, res, next) => (req.method === 'POST' ? anyChange(req, res, next) : next()));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route =
  (fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, paypal: gateway.mode, ai: store.mode.ai });
});

// Each browser asks for one phone's view and gets that phone's chat, and nobody else's.
const viewerOf = (req: Request) => (typeof req.query.viewer === 'string' ? req.query.viewer : undefined);

app.get('/api/state', (req, res) => {
  res.json(store.snapshot(viewerOf(req)));
});

// Live updates: the whole snapshot is small, so every change sends it again.
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const viewer = viewerOf(req);
  const send = () => res.write(`data: ${JSON.stringify(store.snapshot(viewer))}\n\n`);
  send();
  store.on('change', send);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(beat);
    store.off('change', send);
  });
});

app.post(
  '/api/messages',
  aiCall,
  route((req) => {
    const thread = String(req.body?.thread ?? '');
    const text = String(req.body?.text ?? '').trim().slice(0, 2000);
    if (!text) throw Object.assign(new Error('Write a message first.'), { status: 400 });
    if (thread !== 'host') store.member(thread);
    store.addMessage({
      thread,
      from: thread === 'host' ? 'host' : 'member',
      kind: 'text',
      text,
      voice: Boolean(req.body?.voice),
    });
    void bankerRespond(thread).catch((e) => store.log('system', `Banker error: ${e?.message ?? e}`));
    return { ok: true };
  }),
);

app.post(
  '/api/hands/:id/pay',
  route(async (req) => {
    const hand = store.state.hands.find((h) => h.id === req.params.id);
    if (!hand) throw Object.assign(new Error('Unknown hand'), { status: 404 });
    if (gateway.mode === 'sandbox') return { payUrl: hand.payUrl };
    await actions.simulatePayPalPayment(hand.id);
    return { ok: true };
  }),
);

app.post(
  '/api/hands/:id/cash',
  route(async (req) => {
    const hand = store.state.hands.find((h) => h.id === req.params.id);
    if (!hand) throw Object.assign(new Error('Unknown hand'), { status: 404 });
    return { result: await actions.recordCash(hand.memberId, hand.week) };
  }),
);

app.post(
  '/api/hands/:id/remind',
  route(async (req) => {
    const hand = store.state.hands.find((h) => h.id === req.params.id);
    if (!hand) throw Object.assign(new Error('Unknown hand'), { status: 404 });
    return { result: await actions.sendReminder(hand.memberId, undefined, hand.week) };
  }),
);

app.post(
  '/api/swaps/:id/respond',
  route((req) => ({ result: actions.respondSwap(String(req.params.id), Boolean(req.body?.accept), 'member') })),
);

app.post(
  '/api/approvals/:id',
  route(async (req) => ({ result: await actions.decideApproval(String(req.params.id), Boolean(req.body?.approve)) })),
);

app.post(
  '/api/week/advance',
  sendsInvoices,
  route(async () => ({ result: await actions.advanceWeek() })),
);

app.post(
  '/api/paypal/refresh',
  route(async () => ({ result: await actions.refreshFromPayPal() })),
);

app.post(
  '/api/ledger/ask',
  aiCall,
  route(async (req) => {
    const question = String(req.body?.question ?? '').trim().slice(0, 300);
    if (!question) throw Object.assign(new Error('Ask a question first.'), { status: 400 });
    return answerLedgerQuestion(question, store.state);
  }),
);

const utcToday = () => new Date().toISOString().slice(0, 10);

// Start a new circle: the form's starting point, the model's reading, the order, then the invoices.
app.get('/api/setup/template', (_req, res) => {
  res.json({ draft: demoDraft(utcToday()), canRead: hasOpenRouter });
});

app.post(
  '/api/setup/read',
  aiCall,
  route(async (req) => {
    const description = String(req.body?.description ?? '').trim().slice(0, 4000);
    if (!description) throw Object.assign(new Error('Describe your circle first.'), { status: 400 });
    if (!hasOpenRouter || !aiBudget.take()) throw Object.assign(new Error('The AI model is unavailable right now.'), { status: 503 });
    try {
      return await readCircleDescription(description, utcToday());
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      store.log('system', `Couldn't read the circle description (${why.slice(0, 160)}).`);
      throw Object.assign(new Error('The AI model is unavailable right now.'), { status: 503 });
    }
  }),
);

app.post(
  '/api/setup/plan',
  route((req) => {
    const { draft, problems } = cleanDraft(req.body?.draft, utcToday());
    if (problems.length) throw Object.assign(new Error(problems.join(' ')), { status: 400 });
    // The form never gets a private detail back, so when it changes a draft, a blank one means "keep it".
    if (req.body?.editing === true && store.state.circle.phase === 'draft') {
      for (const m of draft.members) {
        m.privateDetail ||= store.state.members.find((x) => x.name === m.name)?.privateDetail ?? '';
      }
    }
    loadDraft(draft);
    return { ok: true };
  }),
);

app.post(
  '/api/setup/start',
  sendsInvoices,
  route(async () => ({ result: await actions.startCircle() })),
);

app.post(
  '/api/demo/reset',
  sendsInvoices,
  route(async (req) => {
    await loadScene(String(req.body?.scene ?? 'demo'));
    return { ok: true };
  }),
);

app.post(
  '/api/notice/dismiss',
  route(() => {
    store.notice = undefined;
    store.changed();
    return { ok: true };
  }),
);

const here = dirname(fileURLToPath(import.meta.url));

// The landing page for judges, at / only. The app answers everywhere else, and /api is untouched.
// The sandbox buyer login is filled in from the environment, so it never sits in a committed file.
const landingDir = join(here, '..', 'landing');
if (existsSync(join(landingDir, 'index.html'))) {
  const landingPage = readFileSync(join(landingDir, 'index.html'), 'utf8');
  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  app.get('/', (_req, res) => {
    const email = process.env.SANDBOX_BUYER_EMAIL?.trim();
    const password = process.env.SANDBOX_BUYER_PASSWORD?.trim();
    const login =
      email && password
        ? `<p class="login"><strong>Sandbox buyer login</strong> for the Pay with PayPal button: <code>${escapeHtml(email)}</code> with password <code>${escapeHtml(password)}</code>. It is PayPal's test environment; the money isn't real.</p>`
        : `<p class="login"><strong>Pay with PayPal</strong> needs a PayPal sandbox personal account (the Devpost testing instructions include one), or tap <strong>Cash</strong> on Devon's row and skip the login.</p>`;
    res.type('html').send(landingPage.replace('<!--LOGIN-->', login));
  });
  app.use('/landing', express.static(landingDir, { maxAge: '1h' }));
}

// The built web app.
const webDist = join(here, '..', 'dist', 'web');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.status) || 500;
  res.status(status).json({ error: err?.message ?? 'Something went wrong' });
});
