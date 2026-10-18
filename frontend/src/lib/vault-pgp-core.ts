import * as pgp from 'openpgp';
import { extractProtonPgp } from './proton-pass-zip';

import { MAX_VAULT_BYTES, MAX_PGP_BYTES, MAX_PGP_KEY_BYTES, type PgpTask } from './vault-pgp-types';

// Keep integrity checks enabled and bound decompression and password KDF memory.
// A dedicated, time-limited worker also makes cancellation interrupt CPU work.
const config: pgp.PartialConfig = {
  allowUnauthenticatedMessages: false,
  allowUnauthenticatedStream: false,
  maxDecompressedMessageSize: MAX_VAULT_BYTES,
  maxArgon2MemoryExponent: 16,
};

export async function processPgp(task: PgpTask): Promise<Uint8Array> {
  const { action, options } = task;
  let { data } = task;
  if (!data.length || data.length > (action === 'encrypt' ? MAX_VAULT_BYTES : MAX_PGP_BYTES)) {
    throw new Error('File exceeds the supported size.');
  }
  if (new TextEncoder().encode(options.key).length > MAX_PGP_KEY_BYTES) {
    throw new Error('Key exceeds the supported size.');
  }
  if (options.mode === 'passphrase' && !options.passphrase) throw new Error('Passphrase required.');

  if (action === 'encrypt') {
    if (options.mode === 'passphrase' && options.passphrase.length < 12) {
      throw new Error('Use an encryption passphrase of at least 12 characters.');
    }
    const key = options.mode === 'key' ? await pgp.readKey({ armoredKey: options.key, config }) : undefined;
    if (key?.isPrivate()) throw new Error('Export requires a public key.');
    const message = await pgp.createMessage({ binary: data, filename: 'trustissues-vault-export.json' });
    const armored = await pgp.encrypt({
      message,
      ...(key ? { encryptionKeys: key } : { passwords: [options.passphrase] }),
      format: 'armored',
      config: { ...config, preferredSymmetricAlgorithm: pgp.enums.symmetric.aes256, s2kIterationCountByte: 255 },
    });
    return new TextEncoder().encode(armored);
  }

  if (data[0] === 0x50 && data[1] === 0x4b) data = extractProtonPgp(data);
  const armored = new TextDecoder().decode(data.subarray(0, 64)).trimStart().startsWith('-----BEGIN PGP MESSAGE-----');
  const message = armored
    ? await pgp.readMessage({ armoredMessage: new TextDecoder().decode(data), config })
    : await pgp.readMessage({ binaryMessage: data, config });
  let key: pgp.PrivateKey | undefined;
  if (options.mode === 'key') {
    key = await pgp.readPrivateKey({ armoredKey: options.key, config });
    if (!key.isDecrypted()) key = await pgp.decryptKey({ privateKey: key, passphrase: options.passphrase, config });
  }
  const result = await pgp.decrypt({
    message,
    ...(key ? { decryptionKeys: key } : { passwords: [options.passphrase] }),
    format: 'binary', config,
  });
  if (!result.data.length || result.data.length > MAX_VAULT_BYTES) {
    throw new Error('Decrypted file exceeds the supported size.');
  }
  // Encryption integrity is required; sender signatures are not authenticated
  // by this import feature. Consume verification promises without claiming trust.
  await Promise.allSettled(result.signatures.map(signature => signature.verified));
  return result.data;
}
