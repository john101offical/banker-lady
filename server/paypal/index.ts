import { config, hasPayPal } from '../config.js';
import type { PaymentsGateway } from './gateway.js';
import { MockGateway } from './mock.js';
import { SandboxGateway } from './sandbox.js';

export const gateway: PaymentsGateway = hasPayPal
  ? new SandboxGateway(config.paypal.clientId, config.paypal.clientSecret)
  : new MockGateway();

export { PayPalError } from './gateway.js';
