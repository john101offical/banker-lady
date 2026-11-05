// In-memory state for the demo circle, plus a change feed for the live UI.
// A real deployment would persist this; for the hackathon, every reset reseeds it.
import { EventEmitter } from 'node:events';
import type {
  ActivityItem,
  ActivityKind,
  Approval,
  Circle,
  Draw,
  Hand,
  Member,
  Message,
  ModeInfo,
  Snapshot,
  Swap,
} from '../shared/types.js';
import { computeRisk, explainOrder } from './domain/circle.js';
import { nowIso } from './domain/dates.js';

/** A member as the server knows them. Everything added here stays here unless publicMember copies it. */
export interface ServerMember extends Member {
  /** PayPal email (a sandbox personal account in sandbox mode). */
  email: string;
  /** The sensitive specifics of their goal. Only their own chat with the banker may use this. */
  privateDetail?: string;
  /** What their own phone suggests saying when they need to draw early. */
  emergencyLine?: string;
}

function publicMember(m: ServerMember): Member {
  return {
    id: m.id,
    name: m.name,
    callName: m.callName,
    language: m.language,
    goal: { label: m.goal.label, needBy: m.goal.needBy },
    isNew: m.isNew,
    circlesCompleted: m.circlesCompleted,
    paysCash: m.paysCash,
    swapPolicy: m.swapPolicy,
    isHost: m.isHost,
    color: m.color,
  };
}

export interface State {
  circle: Circle;
  members: ServerMember[];
  hands: Hand[];
  draws: Draw[];
  swaps: Swap[];
  approvals: Approval[];
  messages: Message[];
  activity: ActivityItem[];
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

class Store extends EventEmitter {
  state!: State;
  mode: ModeInfo = { paypal: 'mock', ai: 'offline' };
  version = 0;
  typing = new Set<string>();
  notice?: Snapshot['notice'];
  private pending: NodeJS.Timeout | null = null;

  load(state: State) {
    this.state = state;
    this.typing.clear();
    this.notice = undefined;
    this.changed();
  }

  /** Coalesces bursts of changes into one push to the browser. */
  changed() {
    this.version += 1;
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.emit('change');
    }, 30);
  }

  member(id: string): ServerMember {
    const m = this.state.members.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown member "${id}"`);
    return m;
  }

  findMember(nameOrId: string): ServerMember | undefined {
    const q = nameOrId.trim().toLowerCase();
    return this.state.members.find(
      (m) =>
        m.id === q ||
        m.name.toLowerCase() === q ||
        m.callName.toLowerCase() === q ||
        m.name.toLowerCase().split(' ')[0] === q.replace(/^(miss|mr|mrs|ms)\.? /, ''),
    );
  }

  hand(memberId: string, week: number): Hand | undefined {
    return this.state.hands.find((h) => h.memberId === memberId && h.week === week);
  }

  draw(week: number): Draw | undefined {
    return this.state.draws.find((d) => d.week === week);
  }

  addMessage(msg: Omit<Message, 'id' | 'createdAt'>): Message {
    const full: Message = { ...msg, id: newId('msg'), createdAt: nowIso() };
    this.state.messages.push(full);
    this.changed();
    return full;
  }

  log(kind: ActivityKind, text: string, ref?: string) {
    this.state.activity.unshift({ id: newId('act'), at: nowIso(), kind, text, ref });
    if (this.state.activity.length > 200) this.state.activity.length = 200;
    this.changed();
  }

  setNotice(level: 'info' | 'error', text: string) {
    this.notice = { level, text, at: nowIso() };
    this.changed();
  }

  setTyping(thread: string, on: boolean) {
    if (on) this.typing.add(thread);
    else this.typing.delete(thread);
    this.changed();
  }

  /** What one phone may see. With no viewer, or an unknown one, it carries no chat at all. */
  snapshot(viewer?: string): Snapshot {
    const s = this.state;
    const me = s.members.find((m) => m.id === viewer);
    const who = viewer === 'host' || me ? viewer! : null;
    const messageCounts: Record<string, number> = {};
    for (const m of s.messages) if (m.from === 'banker') messageCounts[m.thread] = (messageCounts[m.thread] ?? 0) + 1;
    return {
      version: this.version,
      viewer: who,
      mode: this.mode,
      circle: s.circle,
      members: s.members.map(publicMember),
      hands: s.hands,
      draws: s.draws,
      swaps: s.swaps,
      approvals: s.approvals,
      messages: who ? s.messages.filter((m) => m.thread === who) : [],
      messageCounts,
      viewerLine: me?.emergencyLine,
      activity: s.activity,
      plan: explainOrder(s.circle, s.members, s.draws, s.swaps),
      risk: computeRisk(s.circle, s.members, s.hands, s.draws),
      typing: [...this.typing],
      notice: this.notice,
    };
  }
}

export const store = new Store();
