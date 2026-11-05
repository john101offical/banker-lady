import { useState } from 'react';
import type { Snapshot } from '../../../shared/types';
import { post } from '../api';
import { memberMap, money } from '../util';

export function ApprovalBanner({ snap }: { snap: Snapshot }) {
  const pending = snap.approvals.filter((a) => a.status === 'pending');
  const processing = snap.draws.find((d) => d.status === 'processing');
  const members = memberMap(snap);
  const [busy, setBusy] = useState(false);

  if (!pending.length && !processing) return null;

  if (!pending.length && processing) {
    const m = members.get(processing.memberId);
    return (
      <div className="approval sending" role="status">
        <span className="stamp-mark" aria-hidden="true" />
        <p>
          Sending {m?.callName}'s {money(processing.amount)} draw through PayPal Payouts…
        </p>
      </div>
    );
  }

  const a = pending[0];
  const m = members.get(a.memberId);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await post(`/api/approvals/${a.id}`, { approve });
    setBusy(false);
  };
  return (
    <div className="approval" role="region" aria-label="Payout waiting for approval">
      <span className="stamp-mark" aria-hidden="true" />
      <div className="approval-text">
        <p className="approval-ask">
          Send {m?.callName}'s {money(a.amount)} draw through PayPal?
        </p>
        <p className="approval-note">{a.note} Money moves only when you approve.</p>
      </div>
      <div className="approval-actions">
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
