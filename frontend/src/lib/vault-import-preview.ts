import type { VaultImportPreview } from './vault-types';

// Older Go servers serialize nil slices as null. Accept that wire shape where
// it means an empty list, but never turn missing positive-count data into a
// reassuring empty preview or let malformed data reach React's render phase.
export function normalizeCsvPreview(value: unknown): VaultImportPreview {
  const invalid = () => new Error('The import preview was incomplete. Nothing was imported. Please retry.');
  if (!value || typeof value !== 'object') throw invalid();
  const data = value as Record<string, unknown>;
  const entries = data.entries ?? [], conflicts = data.conflicts ?? [], skipped = data.skipped ?? [];
  if (typeof data.format !== 'string' ||
    typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0 ||
    !Array.isArray(entries) || entries.length !== data.total ||
    !Array.isArray(conflicts) || !conflicts.every(name => typeof name === 'string') ||
    !Array.isArray(skipped) || !skipped.every(row => row && typeof row.name === 'string' && typeof row.reason === 'string') ||
    !entries.every(row => row && ['name', 'url', 'username', 'value'].every(key => typeof row[key] === 'string') &&
      ['category', 'notes'].every(key => row[key] === undefined || typeof row[key] === 'string') &&
      (row.skip === undefined || typeof row.skip === 'boolean'))) throw invalid();
  const sourceRows = data.source_rows ?? entries.length + skipped.length;
  if (typeof sourceRows !== 'number' || !Number.isSafeInteger(sourceRows) || sourceRows < entries.length + skipped.length) throw invalid();
  return {format: data.format, total: data.total, entries, conflicts, skipped, source_rows: sourceRows};
}
