// Real PayPal REST calls (sandbox). Docs:
// Invoicing v2: https://developer.paypal.com/docs/api/invoicing/v2/
// Payouts v1:   https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
import { randomUUID } from 'node:crypto';
import {
  PayPalError,
  type InvoiceRequest,
  type InvoiceResult,
  type InvoiceStatus,
  type PaymentRecord,
  type PaymentsGateway,
  type PayoutRequest,
  type PayoutStatus,
} from './gateway.js';

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

type Json = Record<string, any>;

export class SandboxGateway implements PaymentsGateway {
  readonly mode = 'sandbox' as const;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly base = SANDBOX_BASE,
  ) {}

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || !data.access_token) {
      throw new PayPalError(
        `PayPal sign-in failed (${res.status}): ${data.error_description ?? data.error ?? 'check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET'}`,
        res.status,
        data,
      );
    }
    this.cached = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3000) * 1000 };
    return this.cached.token;
  }

  private async call<T = Json>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': randomUUID(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: Json = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const detail = Array.isArray(data.details) && data.details[0] ? data.details[0] : undefined;
      const why = detail?.description ?? detail?.issue ?? data.message ?? data.name ?? res.statusText;
      throw new PayPalError(
        `PayPal ${method} ${path} failed (${res.status}): ${why}${data.debug_id ? ` [debug_id ${data.debug_id}]` : ''}`,
        res.status,
        data,
      );
    }
    return data as T;
  }

  async createAndSendInvoice(req: InvoiceRequest): Promise<InvoiceResult> {
    const value = req.amount.toFixed(2);
    const created = await this.call(
      'POST',
      '/v2/invoicing/invoices',
      {
        detail: {
          invoice_number: req.invoiceNumber,
          currency_code: req.currency,
          note: req.note,
          memo: 'Created by Banker Lady',
          payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: req.dueDate },
        },
        invoicer: { business_name: req.businessName },
        primary_recipients: [
          {
            billing_info: {
              name: { given_name: req.recipient.givenName, surname: req.recipient.surname },
              email_address: req.recipient.email,
            },
          },
        ],
        items: [
          {
            name: req.itemName,
            description: req.itemDescription,
            quantity: '1',
            unit_amount: { currency_code: req.currency, value },
            unit_of_measure: 'QUANTITY',
          },
        ],
        configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false },
      },
      { Prefer: 'return=representation' },
    );
    const invoiceId: string =
      created.id ?? String(created.href ?? '').split('/').pop() ?? '';
    if (!invoiceId) throw new PayPalError('PayPal did not return an invoice id', 500, created);

    const sent = await this.call('POST', `/v2/invoicing/invoices/${invoiceId}/send`, {
      send_to_invoicer: false,
      send_to_recipient: true,
      subject: req.itemName,
      note: req.note,
    });
    let payUrl: string | undefined = sent.href ?? sent.links?.find((l: Json) => l.rel === 'payer-view')?.href;
    if (!payUrl) {
      const inv = await this.call('GET', `/v2/invoicing/invoices/${invoiceId}`);
      payUrl = inv.detail?.metadata?.recipient_view_url;
    }
    return { invoiceId, payUrl: payUrl ?? `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}` };
  }

  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus> {
    const inv = await this.call('GET', `/v2/invoicing/invoices/${invoiceId}`);
    const raw: string = inv.status ?? 'UNKNOWN';
    const transactions: Json[] = inv.payments?.transactions ?? [];
    const last = transactions[transactions.length - 1];
    const method = last?.method === 'PAYPAL' ? 'paypal' : last?.method === 'CASH' ? 'cash' : last ? 'other' : undefined;
    if (raw === 'PAID' || raw === 'MARKED_AS_PAID') return { state: 'paid', raw, method: method ?? 'paypal' };
    if (raw === 'CANCELLED') return { state: 'cancelled', raw };
    if (['SENT', 'UNPAID', 'SCHEDULED', 'DRAFT', 'PAYMENT_PENDING', 'PARTIALLY_PAID'].includes(raw)) {
      return { state: 'unpaid', raw };
    }
    return { state: 'other', raw };
  }

  async recordPayment(invoiceId: string, payment: PaymentRecord): Promise<void> {
    await this.call('POST', `/v2/invoicing/invoices/${invoiceId}/payments`, {
      method: payment.method,
      payment_date: payment.date,
      amount: { currency_code: payment.currency, value: payment.amount.toFixed(2) },
      note: payment.note,
    });
  }

  async sendReminder(invoiceId: string, subject: string, note: string): Promise<void> {
    await this.call('POST', `/v2/invoicing/invoices/${invoiceId}/remind`, {
      subject,
      note,
      send_to_invoicer: false,
      send_to_recipient: true,
    });
  }

  async createPayout(req: PayoutRequest): Promise<PayoutStatus> {
    const data = await this.call('POST', '/v1/payments/payouts', {
      sender_batch_header: {
        sender_batch_id: req.senderBatchId,
        email_subject: req.emailSubject,
        email_message: req.emailMessage,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: req.amount.toFixed(2), currency: req.currency },
          note: req.note,
          sender_item_id: req.senderItemId,
          receiver: req.receiverEmail,
        },
      ],
    });
    const batchId: string = data.batch_header?.payout_batch_id;
    return { batchId, state: 'pending', batchStatus: data.batch_header?.batch_status ?? 'PENDING' };
  }

  async getPayoutStatus(batchId: string): Promise<PayoutStatus> {
    const data = await this.call('GET', `/v1/payments/payouts/${batchId}`);
    const batchStatus: string = data.batch_header?.batch_status ?? 'UNKNOWN';
    const item: Json | undefined = data.items?.[0];
    const itemStatus: string | undefined = item?.transaction_status;
    let state: PayoutStatus['state'] = 'pending';
    if (itemStatus === 'SUCCESS') state = 'success';
    else if (['FAILED', 'RETURNED', 'BLOCKED', 'DENIED', 'REFUNDED', 'REVERSED'].includes(itemStatus ?? '')) state = 'failed';
    else if (['DENIED', 'CANCELED'].includes(batchStatus)) state = 'failed';
    return {
      batchId,
      state,
      batchStatus,
      itemStatus,
      payoutItemId: item?.payout_item_id,
      transactionId: item?.transaction_id,
      reason:
        item?.errors?.message ??
        (itemStatus === 'UNCLAIMED' ? 'The receiver has no PayPal account for that email yet.' : undefined),
    };
  }
}
