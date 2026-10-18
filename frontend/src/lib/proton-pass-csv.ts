import Papa from 'papaparse';
import { convertProtonPass } from './proton-pass-import';

const signature = ['type', 'name', 'password', 'note', 'totp', 'vault'];
const normalize = (header: string) => header.replace(/^\uFEFF/, '').trim().toLowerCase();

/** Return null for other CSVs so their existing server parsers remain in use.
 * Parse cells as strings, preserving password/note whitespace and quoted
 * commas/newlines. Only column identifiers are normalized.
 */
export function convertProtonCsv(text: string, force = false): {text: string; warnings: string[]} | null {
  const header = Papa.parse<string[]>(text, {delimiter: ',', preview: 1, skipEmptyLines: 'greedy'});
  const headers = header.data[0]?.map(normalize) ?? [];
  if (!signature.every(name => headers.includes(name))) {
    if (force) throw new Error('This file does not have the expected Proton Pass CSV columns. Export it again from Proton Pass.');
    return null;
  }
  if (new Set(headers).size !== headers.length || headers.some(name => !name)) {
    throw new Error('Proton Pass CSV has duplicate or empty column names. Nothing was imported.');
  }
  const rows: Record<string, string>[] = [];
  let failed = false, excessive = false;
  Papa.parse<Record<string, string>>(text, {
    delimiter: ',', header: true, transformHeader: normalize, dynamicTyping: false, skipEmptyLines: 'greedy',
    step: (result, parser) => {
      if (result.errors.length) { failed = true; parser.abort(); return; }
      if (rows.length >= 5000) { excessive = true; parser.abort(); return; }
      rows.push(result.data);
    },
  });
  if (excessive) throw new Error('Import up to 5000 Proton Pass CSV rows at a time.');
  if (failed) throw new Error('Proton Pass CSV has malformed quotes or inconsistent columns. Nothing was imported.');
  if (!rows.length) throw new Error('No Proton Pass CSV rows were found.');

  const vaults: Record<string, {name: string; description: string; items: unknown[]}> = Object.create(null);
  const time = (value: string | undefined) => value && /^\d+$/.test(value) ? Number(value) : undefined;
  for (const row of rows) {
    const vaultName = row.vault.trim() || 'Proton Pass';
    const vault = vaults[vaultName] ??= {name: vaultName, description: 'Imported from Proton Pass CSV', items: []};
    let autofillUrls: unknown[] = [];
    if (row.autofillurls) {
      try {
        const parsed = JSON.parse(row.autofillurls);
        if (!Array.isArray(parsed) || !parsed.every(value => value && typeof value.url === 'string')) throw new Error();
        autofillUrls = parsed;
      } catch { throw new Error('Proton Pass CSV contains an invalid autofill URL list. Nothing was imported.'); }
    }
    const firstAutofill = autofillUrls[0] as {url: string} | undefined;
    // Proton's display URL column joins multiple URLs with ", ". The original
    // column and structured URL modes are retained in the secret source data.
    const firstUrl = firstAutofill?.url || row.url?.split(', ')[0] || '';
    vault.items.push({
      state: 1, createTime: time(row.createtime), modifyTime: time(row.modifytime),
      aliasEmail: row.type === 'alias' ? row.email : undefined,
      data: {
        type: row.type.trim(), metadata: {name: row.name, note: row.note}, extraFields: [],
        content: {itemUsername: row.username || row.email || '', password: row.password, urls: firstUrl ? [firstUrl] : [], totpUri: row.totp, autofillUrls},
      },
      csv_fields: row,
    });
  }
  const converted = convertProtonPass(JSON.stringify({version: 'proton-csv', vaults}));
  converted.warnings.push('Proton CSV omits some item details and custom fields. An encrypted JSON/ZIP export is preferred for a complete migration. Original CSV cells are preserved as secret source data.');
  return converted;
}
