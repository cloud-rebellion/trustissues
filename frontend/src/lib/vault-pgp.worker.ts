import { processPgp } from './vault-pgp-core';
import type { PgpTask } from './vault-pgp-types';

self.onmessage = async (event: MessageEvent<PgpTask>) => {
  try {
    const data = await processPgp(event.data);
    self.postMessage({ data }, { transfer: [data.buffer as ArrayBuffer] });
  } catch {
    // Library exceptions can contain packet metadata. Never relay them or log
    // input, private keys, passphrases, or decrypted contents.
    self.postMessage({ error: true });
  }
};
