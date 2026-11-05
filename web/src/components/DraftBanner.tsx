import { useState } from 'react';
import type { Snapshot } from '../../../shared/types';
import { post } from '../api';

/** A new circle waiting for the host's check. Invoices go out only from this button. */
export function DraftBanner({ snap, onEdit }: { snap: Snapshot; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const { circle, members } = snap;
  const send = async () => {
    setBusy(true);
    await post('/api/setup/start');
    setBusy(false);
  };
  return (
    <div className="approval draft" role="region" aria-label="Draw order waiting for your check">
      <span className="stamp-mark" aria-hidden="true" />
      <div className="approval-text">
        <p className="approval-ask">Does this draw order look right for {circle.name}?</p>
        <p className="approval-note">
          Nothing has gone to PayPal yet. Sending starts Week 1 with {members.length} PayPal invoices, one for each hand.
        </p>
      </div>
      <div className="approval-actions">
        <button type="button" className="primary" disabled={busy} onClick={send}>
          {busy ? 'Sending…' : 'Send the first invoices'}
        </button>
        <button type="button" disabled={busy} onClick={onEdit}>
          Change details
        </button>
      </div>
    </div>
  );
}
