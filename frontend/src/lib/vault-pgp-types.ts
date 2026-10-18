export const MAX_VAULT_BYTES = 10 * 1024 * 1024;
export const MAX_PGP_BYTES = 16 * 1024 * 1024;
export const MAX_PGP_KEY_BYTES = 256 * 1024;
export type PgpOptions = { mode: 'passphrase' | 'key'; passphrase: string; key: string };
export type PgpTask = { action: 'encrypt' | 'decrypt'; data: Uint8Array; options: PgpOptions };
