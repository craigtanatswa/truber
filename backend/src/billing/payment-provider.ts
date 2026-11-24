export interface PaymentProvider {
  readonly name: string;
  describe(): { live: false; movesFunds: false };
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

// Paynow, EcoCash, and InnBucks are candidates only. No adapter exists yet;
// this provider records nothing and never calls a network.
export class NoopPaymentProvider implements PaymentProvider {
  readonly name = 'noop';

  describe(): { live: false; movesFunds: false } {
    return { live: false, movesFunds: false };
  }
}
