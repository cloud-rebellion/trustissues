import { MAX_PGP_BYTES, MAX_VAULT_BYTES, type PgpOptions, type PgpTask } from './vault-pgp-types';
export type { PgpOptions } from './vault-pgp-types';

export function isPgpFile(file: File): boolean {
  return /\.(asc|pgp|gpg|zip)$/i.test(file.name);
}

function abortError(): DOMException { return new DOMException('Cancelled', 'AbortError'); }

async function runPgp(action: PgpTask['action'], blob: Blob, options: PgpOptions, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (signal.aborted) throw abortError();
  if (!blob.size || blob.size > (action === 'encrypt' ? MAX_VAULT_BYTES : MAX_PGP_BYTES)) {
    throw new Error(action === 'encrypt' ? 'PGP exports must be 10MB or smaller.' : 'PGP files must be 16MB or smaller.');
  }
  const data = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vault-pgp.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    };
    const fail = () => {
      cleanup();
      reject(new Error(action === 'encrypt'
        ? 'PGP encryption failed. Check the public key or passphrase. No file was downloaded.'
        : 'PGP decryption failed. Check the file, private key and passphrase. Nothing was imported.'));
    };
    const cancel = () => { cleanup(); reject(abortError()); };
    const timeout = setTimeout(fail, 60_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) => { event.preventDefault(); fail(); };
    worker.onmessage = (event: MessageEvent<{ data?: Uint8Array<ArrayBuffer>; error?: boolean }>) => {
      if (!event.data.data || event.data.error) { fail(); return; }
      cleanup();
      resolve(event.data.data);
    };
    try { worker.postMessage({ action, data, options }, [data.buffer]); }
    catch { fail(); }
  });
}

export async function encryptVaultExport(blob: Blob, options: PgpOptions, signal: AbortSignal): Promise<Blob> {
  const data = await runPgp('encrypt', blob, options, signal);
  return new Blob([data], { type: 'application/pgp-encrypted' });
}

export async function decryptVaultImport(file: File, options: PgpOptions, signal: AbortSignal): Promise<File> {
  const data = await runPgp('decrypt', file, options, signal);
  // Ignore untrusted embedded filenames. Detect the actual payload, then let
  // the existing server parsers validate its schema and import permissions.
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new Error('The decrypted file must be UTF-8 CSV or TrustIssues JSON.'); }
  const json = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
  return new File([text], json ? 'decrypted-vault.json' : 'decrypted-vault.csv', {
    type: json ? 'application/json' : 'text/csv',
  });
}

export async function prepareVaultImport(file: File, options: PgpOptions, signal: AbortSignal, csvFormat = 'auto'): Promise<{file: File; warnings: string[]}> {
  if (!file.size || file.size > (isPgpFile(file) ? MAX_PGP_BYTES : MAX_VAULT_BYTES)) {
    throw new Error('Import file is empty or exceeds the supported size.');
  }
  let prepared = isPgpFile(file) ? await decryptVaultImport(file, options, signal) : file;
  if (signal.aborted) throw abortError();
  if (prepared.name.toLowerCase().endsWith('.csv')) {
    const {convertProtonCsv} = await import('./proton-pass-csv');
    const converted = convertProtonCsv(await prepared.text(), csvFormat === 'protonpass');
    if (signal.aborted) throw abortError();
    if (!converted) return {file: prepared, warnings: []};
    return {file: new File([converted.text], 'proton-pass-converted.json', {type: 'application/json'}), warnings: converted.warnings};
  }
  if (!prepared.name.toLowerCase().endsWith('.json')) return { file: prepared, warnings: [] };
  const text = await prepared.text();
  if (signal.aborted) throw abortError();
  // Native JSON is validated by the server unchanged, retaining its existing
  // duplicate-field/schema checks. Only an identified Proton document converts.
  const object = JSON.parse(text);
  if (object?.format === 'trustissues-vault' || !object?.vaults) return {file: prepared, warnings: []};
  const { convertProtonPass } = await import('./proton-pass-import');
  const converted = convertProtonPass(text);
  if (signal.aborted) throw abortError();
  prepared = new File([converted.text], 'proton-pass-converted.json', { type: 'application/json' });
  return { file: prepared, warnings: converted.warnings };
}
