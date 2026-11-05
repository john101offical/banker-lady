import { app } from './app.js';
import * as actions from './actions.js';
import { config, hasPayPal } from './config.js';
import { gateway } from './paypal/index.js';
import { loadScene } from './seed.js';
import { store } from './store.js';

// In sandbox mode, PayPal is the source of truth: check it for paid invoices and settled payouts.
if (hasPayPal) {
  setInterval(() => {
    void actions.refreshFromPayPal();
  }, Math.max(4, config.pollSeconds) * 1000);
}

await loadScene('demo').catch((e) => {
  console.error('Could not load the demo circle:', e);
});

app.listen(config.port, () => {
  console.log(
    `Banker Lady on http://localhost:${config.port}  (PayPal: ${gateway.mode}, AI: ${store.mode.ai}${store.mode.model ? ` ${store.mode.model}` : ''})`,
  );
});
