import { useState } from 'react';
import type { Snapshot } from '../../../shared/types';
import { post } from '../api';
import { longDay, memberMap, money, weekDate } from '../util';

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="12" fill="none" stroke="var(--stamp)" strokeWidth="5" />
      <path
        d="M20 34l9 9 16-20"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopBar({ snap, connected }: { snap: Snapshot; connected: boolean }) {
  const { circle } = snap;
  const members = memberMap(snap);
  const n = circle.memberIds.length;
  const recipient = members.get(circle.drawOrder[circle.currentWeek - 1]);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, path: string, body?: unknown) => {
    setBusy(label);
    await post(path, body);
    setBusy(null);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <div>
          <h1>Banker Lady</h1>
          <p className="sub">{circle.name}</p>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Hand</dt>
          <dd>{money(circle.handAmount)} a week</dd>
        </div>
        <div>
          <dt>Week</dt>
          <dd>
            {circle.currentWeek} of {n}
          </dd>
        </div>
        <div>
          <dt>This draw</dt>
          <dd>
            {recipient?.callName}, {money(circle.handAmount * n)} on {longDay(weekDate(circle, circle.currentWeek))}
          </dd>
        </div>
      </dl>
      <div className="controls">
        <p className="modes">
          <span className={`mode ${snap.mode.paypal}`} title="Where money moves">
            {snap.mode.paypal === 'sandbox' ? 'PayPal sandbox' : 'PayPal simulated'}
          </span>
          <span className={`mode ${snap.mode.ai}`} title="Who writes Banker Lady's replies">
            {snap.mode.ai === 'openrouter'
              ? `OpenRouter: ${snap.mode.model}`
              : snap.mode.ai === 'claude'
                ? `Claude: ${snap.mode.model}`
                : 'Offline banker'}
          </span>
          {!connected && <span className="mode offline-dot">Reconnecting…</span>}
        </p>
        <div className="buttons">
          <button type="button" disabled={!!busy} onClick={() => run('check', '/api/paypal/refresh')}>
            {busy === 'check' ? 'Checking…' : 'Check PayPal'}
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('next', '/api/week/advance')}>
            {busy === 'next' ? 'Opening…' : 'Next week'}
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('reset', '/api/demo/reset')}>
            {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
          </button>
        </div>
      </div>
    </header>
  );
}
