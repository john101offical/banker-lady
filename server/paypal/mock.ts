// An in-memory stand-in for PayPal, so the app runs end to end without keys.
// It mirrors the sandbox gateway's behaviour, including the payout settling a moment later.
import type {
  InvoiceRequest,
  InvoiceResult,
  InvoiceStatus,
  PaymentRecord,
  PaymentsGateway,
  PayoutRequest,
  PayoutStatus,
} from './gateway.js';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (n: number) =>
  Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

interface MockInvoice {
  status: 'SENT' | 'PAID' | 'MARKED_AS_PAID';
  method?: 'paypal' | 'cash' | 'other';
}

interface MockPayout {
  createdAt: number;
  transactionId: string;
  payoutItemId: string;
}

export class MockGateway implements PaymentsGateway {
  readonly mode = 'mock' as const;
  private invoices = new Map<string, MockInvoice>();
  private payouts = new Map<string, MockPayout>();

  async createAndSendInvoice(_req: InvoiceRequest): Promise<InvoiceResult> {
    await pause(120);
    const invoiceId = `INV2-${code(4)}-${code(4)}-${code(4)}-${code(4)}`;
    this.invoices.set(invoiceId, { status: 'SENT' });
    return { invoiceId, payUrl: `mock-paypal://invoice/${invoiceId}` };
  }

  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return { state: 'other', raw: 'NOT_FOUND' };
    if (inv.status === 'SENT') return { state: 'unpaid', raw: 'SENT' };
    return { state: 'paid', raw: inv.status, method: inv.method };
  }

  async recordPayment(invoiceId: string, payment: PaymentRecord): Promise<void> {
    await pause(350);
    const method = payment.method === 'CASH' ? 'cash' : payment.method === 'PAYPAL' ? 'paypal' : 'other';
    this.invoices.set(invoiceId, { status: 'MARKED_AS_PAID', method });
  }

  async sendReminder(_invoiceId: string, _subject: string, _note: string): Promise<void> {
    await pause(250);
  }

  async simulateInvoicePayment(invoiceId: string): Promise<void> {
    await pause(600);
    this.invoices.set(invoiceId, { status: 'PAID', method: 'paypal' });
  }

  async createPayout(_req: PayoutRequest): Promise<PayoutStatus> {
    await pause(500);
    const batchId = code(13);
    this.payouts.set(batchId, { createdAt: Date.now(), transactionId: code(17), payoutItemId: code(13) });
    return { batchId, state: 'pending', batchStatus: 'PENDING' };
  }

  async getPayoutStatus(batchId: string): Promise<PayoutStatus> {
    const p = this.payouts.get(batchId);
    if (!p) return { batchId, state: 'failed', batchStatus: 'UNKNOWN', reason: 'Unknown payout' };
    const settled = Date.now() - p.createdAt > 1800;
    return settled
      ? {
          batchId,
          state: 'success',
          batchStatus: 'SUCCESS',
          itemStatus: 'SUCCESS',
          payoutItemId: p.payoutItemId,
          transactionId: p.transactionId,
        }
      : { batchId, state: 'pending', batchStatus: 'PROCESSING', itemStatus: 'PENDING' };
  }
}
