import { Unzip, UnzipInflate } from 'fflate';
import { MAX_PGP_BYTES } from './vault-pgp-types';

/** Read one encrypted data payload in memory. Never extract archive paths or
 * attachments. Stream small compressed chunks to enforce actual output bounds.
 */
export function extractProtonPgp(archive: Uint8Array): Uint8Array {
  let selected = false, complete = false, fileCount = 0, size = 0;
  const chunks: Uint8Array[] = [];
  const unzip = new Unzip(file => {
    if (++fileCount > 64 || file.name.length > 512 || file.name.includes('\\') ||
      file.name.startsWith('/') || file.name.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Invalid archive structure.');
    }
    if (file.name.endsWith('/')) return;
    if (!/^(?:Proton Pass\/)?data\.(pgp|gpg|asc)$/i.test(file.name) || selected) {
      throw new Error('Use an encrypted Proton Pass export with file attachments disabled.');
    }
    selected = true;
    if (file.originalSize !== undefined && file.originalSize > MAX_PGP_BYTES) throw new Error('Archive payload too large.');
    file.ondata = (error, data, final) => {
      if (error) throw new Error('Invalid archive payload.');
      size += data.length;
      if (size > MAX_PGP_BYTES) throw new Error('Archive payload too large.');
      chunks.push(data.slice());
      if (final) complete = true;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < archive.length; offset += 4096) {
    unzip.push(archive.subarray(offset, offset + 4096), offset + 4096 >= archive.length);
  }
  if (!selected || !complete || !size) throw new Error('No complete encrypted Proton Pass data found.');
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
