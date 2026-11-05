// The PayPal operations Banker Lady needs. Two implementations:
// - SandboxGateway: real PayPal REST calls against the sandbox (Invoicing v2 + Payouts v1)
// - MockGateway: same behaviour in memory, so the app runs with no keys at all.

export interface InvoiceRequest {
  invoiceNumber: string;
  businessName: string;
  recipient: { givenName: string; surname: string; email: string };
  amount: number;
  currency: 'USD';
  itemName: string;
  itemDescription: string;
  dueDate: string;
  note: string;
}

export interface InvoiceResult {
  invoiceId: string;
  payUrl: string;
}

export interface InvoiceStatus {
  state: 'unpaid' | 'paid' | 'cancelled' | 'other';
  raw: string;
  method?: 'paypal' | 'cash' | 'other';
}

export interface PaymentRecord {
  method: 'CASH' | 'PAYPAL' | 'OTHER';
  amount: number;
  currency: 'USD';
  date: string;
  note: string;
}

export interface PayoutRequest {
  senderBatchId: string;
  senderItemId: string;
  receiverEmail: string;
  amount: number;
  currency: 'USD';
  note: string;
  emailSubject: string;
  emailMessage: string;
}

export interface PayoutStatus {
  batchId: string;
  state: 'pending' | 'success' | 'failed';
  batchStatus: string;
  itemStatus?: string;
  payoutItemId?: string;
  transactionId?: string;
  reason?: string;
}

export interface PaymentsGateway {
  readonly mode: 'sandbox' | 'mock';
  createAndSendInvoice(req: InvoiceRequest): Promise<InvoiceResult>;
  getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus>;
  recordPayment(invoiceId: string, payment: PaymentRecord): Promise<void>;
  sendReminder(invoiceId: string, subject: string, note: string): Promise<void>;
  createPayout(req: PayoutRequest): Promise<PayoutStatus>;
  getPayoutStatus(batchId: string): Promise<PayoutStatus>;
  /** Mock only: what happens when a member pays the invoice in PayPal. */
  simulateInvoicePayment?(invoiceId: string): Promise<void>;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
