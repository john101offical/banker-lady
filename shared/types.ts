// Types shared by the server and the web app.

/** Languages the banker can write in. "jm" is Jamaican Patois-flavoured English. */
export type LanguageCode = 'en' | 'jm' | 'es' | 'ht';

/** How a member's own agent answers swap requests. */
export type SwapPolicy = 'ask' | 'auto_if_no_harm';

export interface Goal {
  /** What the member is saving for, in their words. */
  label: string;
  /** ISO date (YYYY-MM-DD) they need the money by, or null if flexible. */
  needBy: string | null;
}

export interface Member {
  id: string;
  name: string;
  /** How the banker addresses them, e.g. "Miss Joyce". */
  callName: string;
  /** PayPal email (a sandbox personal account in sandbox mode). */
  email: string;
  language: LanguageCode;
  goal: Goal;
  /** First circle with this group: draws only after paying in for a few weeks. */
  isNew: boolean;
  circlesCompleted: number;
  paysCash: boolean;
  swapPolicy: SwapPolicy;
  isHost?: boolean;
  /** Avatar ink colour. */
  color: string;
}

export type HandStatus = 'upcoming' | 'due' | 'paid';
export type PayMethod = 'paypal' | 'cash' | 'book';

/** One member's contribution ("hand") for one week. */
export interface Hand {
  id: string;
  week: number;
  memberId: string;
  amount: number;
  status: HandStatus;
  method?: PayMethod;
  paidAt?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  payUrl?: string;
  remindersSent: number;
  lastReminderAt?: string;
}

export type DrawStatus =
  | 'upcoming'
  | 'collecting'
  | 'ready'
  | 'awaiting_approval'
  | 'processing'
  | 'paid'
  | 'failed';

/** The pot one member receives in one week. */
export interface Draw {
  id: string;
  week: number;
  memberId: string;
  amount: number;
  date: string;
  status: DrawStatus;
  method?: 'payout' | 'book';
  payoutBatchId?: string;
  payoutItemId?: string;
  transactionId?: string;
  paidAt?: string;
  failureReason?: string;
}

export type SwapStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/** The requester moves from fromWeek to toWeek; the counterparty moves the other way. */
export interface Swap {
  id: string;
  requesterId: string;
  counterpartyId: string;
  fromWeek: number;
  toWeek: number;
  /** What the counterparty is told about why. Kept general for privacy. */
  reasonPublic: string;
  status: SwapStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: 'member' | 'agent';
}

export interface Approval {
  id: string;
  kind: 'payout';
  week: number;
  memberId: string;
  amount: number;
  note: string;
  status: 'pending' | 'approved' | 'declined' | 'superseded';
  createdAt: string;
}

/** A thread is either a member id or "host" (the circle host's console). */
export type ThreadId = string;

export type MessageKind =
  | 'text'
  | 'pay_request'
  | 'swap_request'
  | 'swap_update'
  | 'payout'
  | 'approval'
  | 'plan';

export interface Message {
  id: string;
  thread: ThreadId;
  from: 'banker' | 'member' | 'host';
  kind: MessageKind;
  text: string;
  createdAt: string;
  voice?: boolean;
  data?: Record<string, unknown>;
}

export type ActivityKind = 'paypal' | 'banker' | 'member' | 'host' | 'system';

export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  text: string;
  ref?: string;
}

export interface Circle {
  id: string;
  name: string;
  handAmount: number;
  currency: 'USD';
  /** ISO date of the week 1 draw. */
  startDate: string;
  frequencyDays: number;
  memberIds: string[];
  /** drawOrder[week - 1] is the member who draws that week. */
  drawOrder: string[];
  currentWeek: number;
  hostId: string;
  /** New members draw only after this many weeks. */
  trustWeeks: number;
}

export interface PlanReason {
  memberId: string;
  week: number;
  date: string;
  reason: string;
  onTime: boolean;
}

export interface RiskRow {
  memberId: string;
  drewWeek: number;
  handsRemaining: number;
  amountRemaining: number;
  remindersAfterDraw: number;
}

export interface RiskSummary {
  exposure: number;
  rows: RiskRow[];
  note: string;
}

export interface ModeInfo {
  paypal: 'sandbox' | 'mock';
  ai: 'openrouter' | 'claude' | 'offline';
  model?: string;
}

export interface Snapshot {
  version: number;
  mode: ModeInfo;
  circle: Circle;
  members: Member[];
  hands: Hand[];
  draws: Draw[];
  swaps: Swap[];
  approvals: Approval[];
  messages: Message[];
  activity: ActivityItem[];
  plan: PlanReason[];
  risk: RiskSummary;
  /** Threads where the banker is currently writing a reply. */
  typing: ThreadId[];
  /** Short notice for the host, e.g. a PayPal error. */
  notice?: { level: 'info' | 'error'; text: string; at: string };
}
