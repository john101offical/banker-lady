import { useEffect, useMemo, useRef, useState } from 'react';
import type { Member, Message, Snapshot } from '../../../shared/types';
import { post } from '../api';
import { clock, longDay, memberMap, money, weekDate } from '../util';
import { Logo } from './TopBar';

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};
const Speech: SpeechCtor | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor" />
    </svg>
  );
}

function PayCard({ m, snap, persona }: { m: Message; snap: Snapshot; persona: string }) {
  const hand = snap.hands.find((h) => h.id === m.data?.handId);
  const [busy, setBusy] = useState(false);
  if (!hand) return null;
  const pay = async () => {
    setBusy(true);
    const res = await post<{ payUrl?: string }>(`/api/hands/${hand.id}/pay`);
    if (res?.payUrl) window.open(res.payUrl, '_blank', 'noopener');
    setBusy(false);
  };
  return (
    <div className="card pay">
      <div className="card-row">
        <span className="card-amount">{money(hand.amount)}</span>
        <span className="card-label">Week {hand.week} hand</span>
      </div>
      {hand.status === 'paid' ? (
        <p className="card-status ok">
          Paid {hand.method === 'cash' ? 'in cash, recorded in PayPal' : hand.method === 'book' ? 'in the book' : 'with PayPal'}
        </p>
      ) : persona === hand.memberId ? (
        <button type="button" className="paypal-btn" disabled={busy} onClick={pay}>
          {busy ? 'Opening PayPal…' : 'Pay with PayPal'}
        </button>
      ) : (
        <p className="card-status warn">Not paid yet</p>
      )}
      {hand.invoiceNumber && <p className="card-ref">Invoice {hand.invoiceNumber}</p>}
    </div>
  );
}

function SwapCard({ m, snap, persona }: { m: Message; snap: Snapshot; persona: string }) {
  const swap = snap.swaps.find((s) => s.id === m.data?.swapId);
  const [busy, setBusy] = useState(false);
  if (!swap) return null;
  const respond = async (accept: boolean) => {
    setBusy(true);
    await post(`/api/swaps/${swap.id}/respond`, { accept });
    setBusy(false);
  };
  if (swap.status === 'pending' && persona === swap.counterpartyId) {
    return (
      <div className="card swap">
        <div className="card-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => respond(true)}>
            Yes, swap
          </button>
          <button type="button" disabled={busy} onClick={() => respond(false)}>
            Not this time
          </button>
        </div>
      </div>
    );
  }
  const label: Record<string, string> = {
    pending: 'Waiting for an answer',
    accepted: 'Swap agreed',
    declined: 'Swap declined',
    cancelled: 'Request withdrawn',
  };
  return <p className={`card-status ${swap.status === 'accepted' ? 'ok' : ''}`}>{label[swap.status]}</p>;
}

function ApprovalCard({ m, snap }: { m: Message; snap: Snapshot }) {
  const a = snap.approvals.find((x) => x.id === m.data?.approvalId);
  const [busy, setBusy] = useState(false);
  if (!a) return null;
  if (a.status !== 'pending') {
    const label: Record<string, string> = {
      approved: 'Approved',
      declined: 'On hold',
      superseded: 'Replaced by a newer request',
    };
    return <p className={`card-status ${a.status === 'approved' ? 'ok' : ''}`}>{label[a.status]}</p>;
  }
  const decide = async (approve: boolean) => {
    setBusy(true);
    await post(`/api/approvals/${a.id}`, { approve });
    setBusy(false);
  };
  return (
    <div className="card approve">
      <div className="card-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => decide(true)}>
          {busy ? 'Sending…' : 'Approve payout'}
        </button>
        <button type="button" disabled={busy} onClick={() => decide(false)}>
          Hold
        </button>
      </div>
    </div>
  );
}

function PayoutCard({ m }: { m: Message }) {
  return (
    <div className="card payout">
      <div className="card-row">
        <span className="card-amount">{money(Number(m.data?.amount ?? 0))}</span>
        <span className="card-label">received in PayPal</span>
      </div>
      {m.data?.transactionId ? <p className="card-ref">Transaction {String(m.data.transactionId)}</p> : null}
    </div>
  );
}

function Bubble({ m, snap, persona }: { m: Message; snap: Snapshot; persona: string }) {
  const mine = m.from !== 'banker';
  return (
    <div className={`bubble ${mine ? 'mine' : 'banker'} kind-${m.kind}`}>
      {m.voice && (
        <span className="voice-tag">
          <MicIcon /> Voice note
        </span>
      )}
      <p>{m.text}</p>
      {m.kind === 'pay_request' && <PayCard m={m} snap={snap} persona={persona} />}
      {m.kind === 'swap_request' && <SwapCard m={m} snap={snap} persona={persona} />}
      {m.kind === 'approval' && <ApprovalCard m={m} snap={snap} />}
      {m.kind === 'payout' && <PayoutCard m={m} />}
      <time dateTime={m.createdAt}>{clock(m.createdAt)}</time>
    </div>
  );
}

function suggestionsFor(snap: Snapshot, persona: string, me: Member): string[] {
  const { circle } = snap;
  const week = circle.currentWeek;
  const members = memberMap(snap);
  if (circle.phase === 'draft') {
    if (persona === 'host') return ['Why is the order like this?'];
    return [me.language === 'jm' ? 'Wen mi draw?' : 'When is my draw?'];
  }
  if (persona === 'host') {
    const out: string[] = [];
    for (const h of snap.hands.filter((x) => x.week === week && x.status === 'due')) {
      const m = members.get(h.memberId)!;
      const first = m.name.split(' ')[0];
      out.push(m.paysCash ? `${first} gave me cash` : `Remind ${first}, kindly`);
    }
    out.push('Who still owes this week?');
    return out.slice(0, 3);
  }
  const out: string[] = [];
  const myWeek = circle.drawOrder.indexOf(me.id) + 1;
  const hand = snap.hands.find((h) => h.memberId === me.id && h.week === week);
  if (myWeek > week) {
    out.push(
      me.language === 'jm'
        ? 'Mi madda inna hospital an dem need money fi di medicine. Mi can get mi draw early?'
        : 'I have a family emergency. Can I get my draw early?',
    );
  }
  out.push(me.language === 'jm' ? 'Wen mi draw?' : 'When is my draw?');
  if (hand?.status === 'due') out.push(me.language === 'jm' ? 'How mi fi pay?' : 'How do I pay?');
  return out.slice(0, 3);
}

export function Phone({ snap, persona }: { snap: Snapshot; persona: string }) {
  const members = memberMap(snap);
  const host = members.get(snap.circle.hostId)!;
  const me = persona === 'host' ? host : members.get(persona) ?? host;
  const thread = persona;
  const msgs = useMemo(() => snap.messages.filter((m) => m.thread === thread), [snap.messages, thread]);
  const typing = snap.typing.includes(thread);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const recRef = useRef<InstanceType<SpeechCtor> | null>(null);
  const heard = useRef('');

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, typing, thread]);

  // Coming back from PayPal's tab: check for the payment right away.
  useEffect(() => {
    if (snap.mode.paypal !== 'sandbox') return;
    const onFocus = () => void post('/api/paypal/refresh');
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [snap.mode.paypal]);

  const send = async (t: string, voice = false) => {
    const clean = t.trim();
    if (!clean) return;
    setText('');
    await post('/api/messages', { thread, text: clean, voice });
  };

  const toggleVoice = () => {
    if (!Speech) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Speech();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    heard.current = '';
    rec.onresult = (e: any) => {
      const words = Array.from(e.results as ArrayLike<any>)
        .map((r: any) => r[0].transcript)
        .join('');
      heard.current = words;
      setText(words);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      if (heard.current.trim()) void send(heard.current, true);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const suggestions = suggestionsFor(snap, persona, me);
  const myWeek = snap.circle.drawOrder.indexOf(me.id) + 1;

  return (
    <div className="phone-wrap">
      <p className="phone-owner">
        {persona === 'host' ? `${host.callName}'s phone, host console` : `${me.name}'s phone`}
        {persona !== 'host' && myWeek > 0 && (
          <span>
            Draws Week {myWeek}, {longDay(weekDate(snap.circle, myWeek))}
          </span>
        )}
      </p>
      <div className="phone" aria-label={`${me.name}'s phone`}>
        <div className="phone-top">
          <Logo />
          <div>
            <b>Banker Lady</b>
            <small>{snap.circle.name}</small>
          </div>
        </div>
        <div className="phone-body" ref={body} aria-live="polite">
          {msgs.length === 0 && <p className="empty">No messages yet. Say hello to Banker Lady.</p>}
          {msgs.map((m) => (
            <Bubble key={m.id} m={m} snap={snap} persona={persona} />
          ))}
          {typing && (
            <div className="bubble banker typing" role="status">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="sr-only">Banker Lady is writing</span>
            </div>
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="suggest" aria-label="Suggested messages">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={persona === 'host' ? 'Tell the banker…' : 'Message Banker Lady…'}
            aria-label="Message"
          />
          <button
            type="button"
            className={`mic ${listening ? 'on' : ''}`}
            onClick={toggleVoice}
            disabled={!Speech}
            aria-label={listening ? 'Stop recording' : 'Record a voice note'}
            title={Speech ? 'Record a voice note' : 'Voice notes need Chrome or Edge'}
          >
            <MicIcon />
          </button>
          <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
