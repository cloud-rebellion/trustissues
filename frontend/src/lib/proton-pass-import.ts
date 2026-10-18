import { MAX_VAULT_BYTES } from './vault-pgp-types';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Proton Pass export.');
  return value as ObjectValue;
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function timestamp(value: unknown, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value * 1000).toISOString() : fallback;
}

/** Convert Proton's versioned export into the existing atomic native importer.
 * Preserve the original item in secret fields so unsupported properties are
 * never silently lost. No imported data enables egress, rotation or membership.
 */
export function convertProtonPass(text: string): { text: string; warnings: string[] } {
  const source = object(JSON.parse(text));
  if (source.format === 'trustissues-vault') return { text, warnings: [] };
  if (typeof source.version !== 'string') throw new Error('Unsupported JSON export.');
  const vaults = object(source.vaults);
  if (source.encrypted === true) throw new Error('The Proton Pass data is still encrypted.');
  const now = new Date().toISOString();
  const collections: ObjectValue[] = [];
  const entries: ObjectValue[] = [];
  const names = new Set<string>();
  let trashed = 0, renamed = 0, generic = 0, passkeys = 0, emptyVaults = 0;
  const vaultRows = Object.values(vaults);
  if (vaultRows.length > 5000) throw new Error('Too many Proton Pass vaults.');
  for (const raw of vaultRows) {
    const vault = object(raw);
    if (!Array.isArray(vault.items)) throw new Error('Invalid Proton Pass vault items.');
    if (vault.items.length + entries.length > 5000) throw new Error('Import up to 5000 entries at a time.');
    const collectionID = `proton-vault-${collections.length + 1}`;
    const vaultName = string(vault.name).trim();
    if (!vaultName) throw new Error('A Proton Pass vault has no name.');
    const start = entries.length;
    for (const rawItem of vault.items) {
      const item = object(rawItem);
      if (item.state === 2) { trashed++; continue; }
      if (item.state !== undefined && item.state !== 1) throw new Error('Unknown Proton Pass item state.');
      if (Array.isArray(item.files) && item.files.length) {
        throw new Error('Attachments are not supported. Export Proton Pass with file attachments disabled.');
      }
      const data = object(item.data), metadata = object(data.metadata), content = object(data.content);
      let name = string(metadata.name).trim();
      if (!name) throw new Error('A Proton Pass item has no name.');
      if (names.has(name)) {
        const base = `${name} (${vaultName})`;
        name = base;
        for (let index = 2; names.has(name); index++) name = `${base} ${index}`;
        renamed++;
      }
      names.add(name);
      const login = data.type === 'login' && Boolean(string(content.password));
      const note = data.type === 'note';
      if (!login && !note) generic++;
      if (Array.isArray(content.passkeys)) passkeys += content.passkeys.length;
      const customFields: { label: string; value: string; secret: boolean }[] = [];
      if (string(content.totpUri)) customFields.push({label: 'TOTP', value: string(content.totpUri), secret: true});
      if (!note && string(metadata.note)) customFields.push({label: 'Proton Pass note', value: string(metadata.note), secret: true});
      // At most 8000 UTF-8 bytes per chunk, without splitting surrogate pairs.
      const original = Array.from(JSON.stringify(item));
      for (let offset = 0; offset < original.length; offset += 2000) {
        customFields.push({label: `Proton Pass source ${Math.floor(offset / 2000) + 1}`, value: original.slice(offset, offset + 2000).join(''), secret: true});
      }
      if (customFields.length > 50) throw new Error('A Proton Pass item exceeds the supported field limit. Nothing was imported.');
      const urls = Array.isArray(content.urls) ? content.urls : [];
      const autofill = Array.isArray(content.autofillUrls) ? content.autofillUrls : [];
      const firstUrl = string(urls[0]) || (autofill.length ? string(object(autofill[0]).url) : '');
      const created = timestamp(item.createTime, now);
      const updated = timestamp(item.modifyTime, created);
      entries.push({
        source_id: `proton-entry-${entries.length + 1}`, collection_id: collectionID,
        name, url: firstUrl, alias_url: '',
        username: string(content.itemUsername) || string(content.username) || string(content.itemEmail) || string(item.aliasEmail),
        value: login ? string(content.password) : note ? string(metadata.note) || JSON.stringify(content) : JSON.stringify(content),
        category: login ? 'login' : 'other', notes: 'Imported from Proton Pass. Original data is preserved in secret custom fields.',
        auto_login: false, rotation_interval_days: null, expires_at: null, last_rotated_at: null,
        provider: '', provider_meta: '{}', auto_rotate: false,
        custom_fields: customFields, destination_patterns: [],
        created_at: created, updated_at: updated < created ? created : updated,
      });
    }
    if (entries.length > start) collections.push({source_id: collectionID, name: vaultName, description: string(vault.description), private_access_policy: 'standard', created_at: now, updated_at: now});
    else emptyVaults++;
  }
  if (!entries.length) throw new Error('No active Proton Pass items were found.');
  const warnings = [
    'Proton Pass vaults become new shared vaults managed by you. Memberships are not imported.',
    'Original item data, additional URLs and custom fields are preserved in secret custom fields. Sender signatures are not verified.',
    'Folders are flattened within each vault. Attachments are not imported.',
  ];
  if (trashed) warnings.push(`${trashed} trashed items were excluded.`);
  if (emptyVaults) warnings.push(`${emptyVaults} empty vaults were excluded.`);
  if (renamed) warnings.push(`${renamed} duplicate names were qualified with a vault name or number.`);
  if (generic) warnings.push(`${generic} items without a supported password login are preserved as generic credentials; their original content is retained.`);
  if (passkeys) warnings.push(`${passkeys} passkeys are preserved as source data only. They cannot authenticate in TrustIssues; re-register them separately.`);
  const converted = JSON.stringify({format: 'trustissues-vault', version: 2, ingress_scope: 'public', exported_at: now, collections, entries});
  if (new TextEncoder().encode(converted).length > MAX_VAULT_BYTES) throw new Error('Converted data exceeds the 10MB import limit. Export fewer vaults.');
  return { text: converted, warnings };
}
