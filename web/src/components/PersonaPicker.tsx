import type { Member, Snapshot } from '../../../shared/types';
import { initials } from '../util';

export function Avatar({ m, size = 32 }: { m: Pick<Member, 'name' | 'color'>; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, color: m.color, borderColor: m.color }} aria-hidden="true">
      {initials(m.name)}
    </span>
  );
}

export function PersonaPicker({
  snap,
  persona,
  onPick,
  unread,
}: {
  snap: Snapshot;
  persona: string;
  onPick: (id: string) => void;
  unread: Record<string, boolean>;
}) {
  const host = snap.members.find((m) => m.id === snap.circle.hostId)!;
  const people = [
    { id: 'host', label: `${host.callName} (host)`, m: host },
    ...snap.members.filter((m) => m.id !== host.id).map((m) => ({ id: m.id, label: m.callName, m })),
  ];
  return (
    <nav className="personas" aria-label="Whose phone to show">
      <p className="personas-label">Show the phone of</p>
      <div className="persona-row">
        {people.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`persona ${persona === p.id ? 'is-on' : ''}`}
            aria-pressed={persona === p.id}
            onClick={() => onPick(p.id)}
          >
            <Avatar m={p.m} size={26} />
            <span>{p.label}</span>
            {unread[p.id] && <span className="dot" aria-label="new message" />}
          </button>
        ))}
      </div>
    </nav>
  );
}
