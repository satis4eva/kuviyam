'use strict';

/*
 * Payment providers. Only the test provider is active: it confirms a payment without moving money,
 * so the whole donation flow can be reviewed safely.
 *
 * DPayments goes here once its API details and CharityHub's merchant account are agreed (plan, Phase 0).
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

/*
 * Two separate gateways:
 *   'donations' (PAYMENT_PROVIDER)        CharityHub's own account: every donation goes to CharityHub.
 *   'tickets'   (TICKET_PAYMENT_PROVIDER) the platform's account: event ticket money, from which the platform
 *                                         keeps its commission and pays the rest to the event organiser.
 */
function provider(purpose = 'donations') {
  const name = (purpose === 'tickets' ? process.env.TICKET_PAYMENT_PROVIDER : process.env.PAYMENT_PROVIDER) || 'test';
  const p = providers[name];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
  return { name, purpose, ...p };
}

module.exports = { provider };
