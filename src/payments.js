'use strict';

/*
 * Payment providers. Only the test provider is active: it confirms a payment without moving money,
 * so the whole donation flow can be reviewed safely.
 *
 * DPayments goes here once its API details and Kuviyam's merchant account are agreed (plan, Phase 0).
 * The shape every provider follows:
 *   start(donation)  -> { redirect }   send the donor to the provider's checkout
 *   confirm(donation, req) -> { ok, providerRef }   verify the result (webhook or return URL)
 */
const providers = {
  test: {
    testMode: true,
    start: (donation) => ({ redirect: `/pay/${donation.ref}` }),
    confirm: (donation) => ({ ok: true, providerRef: `test_${donation.ref}` })
  },
  dpayments: {
    testMode: false,
    start() { throw new Error('DPayments is not configured yet. Set PAYMENT_PROVIDER=test until the merchant account and API keys are in place.'); },
    confirm() { throw new Error('DPayments is not configured yet.'); }
  }
};

function provider() {
  const name = process.env.PAYMENT_PROVIDER || 'test';
  const p = providers[name];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
  return { name, ...p };
}

module.exports = { provider };
