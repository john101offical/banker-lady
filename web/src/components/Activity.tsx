import type { ActivityKind, Snapshot } from '../../../shared/types';
import { clock } from '../util';

const WHO: Record<ActivityKind, string> = {
  paypal: 'PayPal',
  banker: 'Banker Lady',
  member: 'Member',
  host: 'Host',
  system: 'System',
};

export function Activity({ snap }: { snap: Snapshot }) {
  if (!snap.activity.length) return <p className="panel-lead">Nothing has happened yet this week.</p>;
  return (
    <ol className="activity">
      {snap.activity.map((a) => (
        <li key={a.id} className={`act ${a.kind}`}>
          <span className="act-who">{WHO[a.kind]}</span>
          <span className="act-text">{a.text}</span>
          <time dateTime={a.at}>{clock(a.at)}</time>
        </li>
      ))}
    </ol>
  );
}
