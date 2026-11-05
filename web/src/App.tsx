import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Snapshot } from '../../shared/types';
import { onApiError, post, useSnapshot } from './api';
import { Activity } from './components/Activity';
import { ApprovalBanner } from './components/ApprovalBanner';
import { Book } from './components/Book';
import { DraftBanner } from './components/DraftBanner';
import { Phone } from './components/Phone';
import { PersonaPicker } from './components/PersonaPicker';
import { Risk } from './components/Risk';
import { SetupDialog } from './components/SetupDialog';
import { TopBar } from './components/TopBar';

// Bryntum and AG Grid are large, so they load after the book and the phone are on screen.
const Timeline = lazy(() => import('./components/Timeline').then((m) => ({ default: m.Timeline })));
const Ledger = lazy(() => import('./components/Ledger').then((m) => ({ default: m.Ledger })));

type Tab = 'timeline' | 'ledger' | 'activity' | 'risk';
const TABS: { id: Tab; label: string }[] = [
  { id: 'timeline', label: 'Draw timeline' },
  { id: 'ledger', label: 'PayPal ledger' },
  { id: 'activity', label: 'Activity' },
  { id: 'risk', label: 'Who still owes' },
];

/** When the draw order changes, let the browser animate each stamp to its new week. */
function useAnimatedSnapshot(viewer: string): { snap: Snapshot | null; connected: boolean } {
  const { snap: incoming, connected } = useSnapshot(viewer);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const lastOrder = useRef<string>('');
  useEffect(() => {
    if (!incoming) return;
    const order = incoming.circle.drawOrder.join(',');
    const changed = lastOrder.current !== '' && order !== lastOrder.current;
    lastOrder.current = order;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (changed && doc.startViewTransition && !reduce) {
      doc.startViewTransition(() => flushSync(() => setSnap(incoming)));
    } else {
      setSnap(incoming);
    }
  }, [incoming]);
  return { snap, connected };
}

export default function App() {
  const [persona, setPersona] = useState<string>('host');
  const { snap, connected } = useAnimatedSnapshot(persona);
  const [tab, setTab] = useState<Tab>('timeline');
  const [toast, setToast] = useState<string | null>(null);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [setup, setSetup] = useState<'new' | 'edit' | null>(null);

  useEffect(() => onApiError((t) => setToast(t)), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Unread dots: banker messages a persona hasn't looked at yet.
  const counts = useMemo<Record<string, number>>(() => snap?.messageCounts ?? {}, [snap?.messageCounts]);
  useEffect(() => {
    setSeen((s) => (s[persona] === counts[persona] ? s : { ...s, [persona]: counts[persona] ?? 0 }));
  }, [persona, counts]);
  const unread = useMemo(() => {
    const u: Record<string, boolean> = {};
    for (const [thread, n] of Object.entries(counts)) u[thread] = thread !== persona && n > (seen[thread] ?? 0);
    return u;
  }, [counts, seen, persona]);

  // A different circle has different people: go back to the host, with everything so far marked read.
  const circleId = snap?.circle.id;
  useEffect(() => {
    if (!circleId) return;
    setPersona('host');
    setTab('timeline');
    setSeen({ ...counts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);

  if (!snap) {
    return (
      <div className="loading" role="status">
        <p>Opening the book…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar snap={snap} connected={connected} onNewCircle={() => setSetup('new')} />
      <main className="desk">
        {snap.notice && (
          <div className={`notice ${snap.notice.level}`} role="alert">
            <p>{snap.notice.text}</p>
            <button type="button" className="link" onClick={() => post('/api/notice/dismiss')}>
              Dismiss
            </button>
          </div>
        )}
        {snap.circle.phase === 'draft' && <DraftBanner snap={snap} onEdit={() => setSetup('edit')} />}
        <ApprovalBanner snap={snap} />
        <Book snap={snap} persona={persona} onPick={setPersona} />
        <section className="folder" aria-label="Circle details">
          <div className="folder-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                className={tab === t.id ? 'is-on' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="folder-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <Suspense fallback={<p className="panel-lead">Loading…</p>}>
              {tab === 'timeline' && <Timeline key={snap.circle.id} snap={snap} />}
              {tab === 'ledger' && <Ledger key={snap.circle.id} snap={snap} />}
            </Suspense>
            {tab === 'activity' && <Activity snap={snap} />}
            {tab === 'risk' && <Risk snap={snap} />}
          </div>
        </section>
      </main>
      <aside className="hand-panel" aria-label="Phones">
        <PersonaPicker snap={snap} persona={persona} onPick={setPersona} unread={unread} />
        <Phone snap={snap} persona={persona} />
      </aside>
      {setup && <SetupDialog mode={setup} snap={snap} onClose={() => setSetup(null)} />}
      {toast && (
        <div className="toast" role="alert">
          <p>{toast}</p>
          <button type="button" className="link" onClick={() => setToast(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
