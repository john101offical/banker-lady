import { useState } from 'react';
import type { Draw, Hand, Member, Snapshot } from '../../../shared/types';
import { post } from '../api';
import { money, shortDay, weekDate } from '../util';
import { Avatar } from './PersonaPicker';

const METHOD: Record<string, string> = { paypal: 'PayPal', cash: 'cash', book: 'book' };

function HandMark({ hand, canAct, member }: { hand?: Hand; canAct: boolean; member: Member }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!hand || hand.status === 'upcoming') return null;
  if (hand.status === 'paid') {
    return (
      <span className={`tick ${hand.method ?? ''}`} title={`Paid${hand.method ? ` (${METHOD[hand.method]})` : ''}`}>
        <span aria-hidden="true">✓</span>
        <small>{METHOD[hand.method ?? 'paypal']}</small>
      </span>
    );
  }
  const act = async (what: 'cash' | 'remind') => {
    setBusy(what);
    await post(`/api/hands/${hand.id}/${what}`);
    setBusy(null);
  };
  return (
    <span className="due">
      <span className="ring" aria-hidden="true" />
      <small>{hand.remindersSent ? `reminded${hand.remindersSent > 1 ? ` ×${hand.remindersSent}` : ''}` : hand.invoiceId ? 'invoiced' : 'due'}</small>
      {canAct && (
        <span className="cell-actions">
          <button
            type="button"
            disabled={!!busy}
            onClick={(e) => {
              e.stopPropagation();
              void act('cash');
            }}
            aria-label={`Record cash from ${member.callName}`}
          >
            {busy === 'cash' ? '…' : 'Cash'}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={(e) => {
              e.stopPropagation();
              void act('remind');
            }}
            aria-label={`Remind ${member.callName}`}
          >
            {busy === 'remind' ? '…' : 'Remind'}
          </button>
        </span>
      )}
    </span>
  );
}

function Stamp({ draw, memberId }: { draw: Draw; memberId: string }) {
  const label =
    draw.status === 'paid'
      ? `Drew ${money(draw.amount)}`
      : draw.status === 'processing'
        ? 'Sending…'
        : `Draws ${money(draw.amount)}`;
  return (
    <span
      className={`stamp ${draw.status}`}
      style={{ viewTransitionName: `stamp-${memberId}` } as React.CSSProperties}
      title={`Week ${draw.week} draw: ${draw.status.replace('_', ' ')}`}
    >
      {label}
    </span>
  );
}

export function Book({ snap, persona, onPick }: { snap: Snapshot; persona: string; onPick: (id: string) => void }) {
  const { circle, members, hands, draws } = snap;
  const weeks = circle.memberIds.map((_, i) => i + 1);
  const handOf = (memberId: string, week: number) => hands.find((h) => h.memberId === memberId && h.week === week);
  const drawOf = (week: number) => draws.find((d) => d.week === week);
  const paidCount = (week: number) => hands.filter((h) => h.week === week && h.status === 'paid').length;
  const draft = circle.phase === 'draft';
  const isNow = (week: number) => !draft && week === circle.currentWeek;
  const why = (memberId: string) => snap.plan.find((p) => p.memberId === memberId);
  // A draft is about the order, so its rows read down the draws like a staircase.
  const rows = draft ? circle.drawOrder.map((id) => members.find((m) => m.id === id)!) : members;

  return (
    <section className="partner-book" aria-labelledby="book-title">
      <div className="book-head">
        <h2 id="book-title">The book</h2>
        <p>
          {draft
            ? "The order I'd draw in, and why. Tap a name to open that member's phone."
            : "Every hand and every draw, as PayPal records them. Tap a name to open that member's phone."}
        </p>
      </div>
      <div className="sheet-wrap">
        <div className="sheet" role="table" aria-label="Hands and draws by week" style={{ ['--weeks' as string]: weeks.length }}>
          <div className="sheet-row sheet-head" role="row">
            <div role="columnheader" className="who-head">
              Member
            </div>
            {weeks.map((w) => (
              <div role="columnheader" key={w} className={`wk ${isNow(w) ? 'now' : ''}`}>
                <span>Week {w}</span>
                <small>{shortDay(weekDate(circle, w))}</small>
              </div>
            ))}
          </div>
          {rows.map((m) => (
            <div
              key={m.id}
              role="row"
              className={`sheet-row ${persona === m.id || (persona === 'host' && m.isHost) ? 'is-picked' : ''}`}
            >
              <div role="rowheader" className="who">
                <button type="button" className="who-btn" onClick={() => onPick(m.isHost ? 'host' : m.id)}>
                  <Avatar m={m} />
                  <span className="who-text">
                    <span className="who-name">
                      {m.name}
                      {m.isHost && <span className="tag">host</span>}
                      {m.isNew && <span className="tag new">new</span>}
                    </span>
                    {draft ? (
                      <small className={why(m.id)?.onTime === false ? 'why-late' : ''}>{why(m.id)?.reason}</small>
                    ) : (
                      <small>
                        For {m.goal.label}
                        {m.goal.needBy ? `, by ${shortDay(m.goal.needBy)}` : ', no fixed date'}
                      </small>
                    )}
                  </span>
                </button>
              </div>
              {weeks.map((w) => {
                const draw = drawOf(w);
                const isDraw = circle.drawOrder[w - 1] === m.id;
                return (
                  <div role="cell" key={w} className={`cell ${isNow(w) ? 'now' : ''}`}>
                    <HandMark hand={handOf(m.id, w)} member={m} canAct={persona === 'host' && isNow(w)} />
                    {isDraw && draw && <Stamp draw={draw} memberId={m.id} />}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="sheet-row sheet-foot" role="row">
            <div role="rowheader" className="who-head">
              Hands in
            </div>
            {weeks.map((w) => (
              <div role="cell" key={w} className={`wk ${isNow(w) ? 'now' : ''}`}>
                {!draft && w <= circle.currentWeek ? `${paidCount(w)} of ${members.length}` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
