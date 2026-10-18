// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as pgp from 'openpgp';
import { zipSync } from 'fflate';
import { processPgp } from '@/lib/vault-pgp-core';
import { extractProtonPgp } from '@/lib/proton-pass-zip';
import { convertProtonPass } from '@/lib/proton-pass-import';
import { MAX_PGP_BYTES, MAX_VAULT_BYTES, type PgpOptions } from '@/lib/vault-pgp-types';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const options: PgpOptions = { mode: 'passphrase', passphrase: 'disposable-export-passphrase', key: '' };
const native = encoder.encode('{"format":"trustissues-vault","version":2,"entries":[],"fixture":"PRIVATE-FIXTURE"}');

describe('actual OpenPGP encryption and decryption', () => {
  it('round trips an armored native export without plaintext in the downloaded bytes', async () => {
    const encrypted = await processPgp({action: 'encrypt', data: native, options});
    expect(decoder.decode(encrypted)).toMatch(/^-----BEGIN PGP MESSAGE-----/);
    expect(decoder.decode(encrypted)).not.toContain('PRIVATE-FIXTURE');
    expect(await processPgp({action: 'decrypt', data: encrypted, options})).toEqual(native);
    await expect(processPgp({action: 'decrypt', data: encrypted, options: {...options, passphrase: 'wrong'}})).rejects.toThrow();
  });

  it('decrypts binary PGP and refuses corrupted authenticated ciphertext and plaintext packets', async () => {
    const encrypted = await pgp.encrypt({message: await pgp.createMessage({binary: native}), passwords: [options.passphrase], format: 'binary'});
    expect(await processPgp({action: 'decrypt', data: encrypted, options})).toEqual(native);
    const damaged = encrypted.slice();
    damaged[damaged.length - 2] ^= 0x80;
    await expect(processPgp({action: 'decrypt', data: damaged, options})).rejects.toThrow();
    const plaintext = (await pgp.createMessage({binary: native})).write();
    await expect(processPgp({action: 'decrypt', data: plaintext, options})).rejects.toThrow();
  });

  it('supports recipient public keys and passphrase-protected private keys', async () => {
    const keys = await pgp.generateKey({type: 'ecc', curve: 'curve25519Legacy', userIDs: [{name: 'Disposable fixture'}], passphrase: options.passphrase, format: 'armored'});
    const encrypted = await processPgp({action: 'encrypt', data: native, options: {mode: 'key', key: keys.publicKey, passphrase: ''}});
    expect(await processPgp({action: 'decrypt', data: encrypted, options: {mode: 'key', key: keys.privateKey, passphrase: options.passphrase}})).toEqual(native);
    await expect(processPgp({action: 'decrypt', data: encrypted, options: {mode: 'key', key: keys.privateKey, passphrase: 'wrong'}})).rejects.toThrow();
    await expect(processPgp({action: 'encrypt', data: native, options: {mode: 'key', key: keys.privateKey, passphrase: ''}})).rejects.toThrow();
  });

  it('opens a Proton-style encrypted ZIP without extracting a plaintext file', async () => {
    const encrypted = await processPgp({action: 'encrypt', data: native, options});
    const archive = zipSync({'Proton Pass/data.pgp': encrypted});
    expect(await processPgp({action: 'decrypt', data: archive, options})).toEqual(native);
  });

  it('enforces cleartext, ciphertext and decompressed size limits', async () => {
    await expect(processPgp({action: 'encrypt', data: new Uint8Array(MAX_VAULT_BYTES + 1), options})).rejects.toThrow();
    await expect(processPgp({action: 'decrypt', data: new Uint8Array(MAX_PGP_BYTES + 1), options})).rejects.toThrow();
    const message = await pgp.createMessage({binary: new Uint8Array(MAX_VAULT_BYTES + 100)});
    const compressed = await pgp.encrypt({message, passwords: [options.passphrase], format: 'binary', config: {preferredCompressionAlgorithm: pgp.enums.compression.zlib}});
    await expect(processPgp({action: 'decrypt', data: compressed, options})).rejects.toThrow();
  });
});

describe('Proton Pass ZIP boundaries', () => {
  it('rejects attachments, ambiguous payloads, traversal and oversized inflated data', () => {
    const data = encoder.encode('fixture');
    expect(() => extractProtonPgp(zipSync({'Proton Pass/data.pgp': data, 'Proton Pass/files/a.txt': data}))).toThrow();
    expect(() => extractProtonPgp(zipSync({'data.pgp': data, 'Proton Pass/data.pgp': data}))).toThrow();
    expect(() => extractProtonPgp(zipSync({'../data.pgp': data}))).toThrow();
    expect(() => extractProtonPgp(zipSync({'Proton Pass/data.pgp': new Uint8Array(MAX_PGP_BYTES + 1)}))).toThrow();
    // A lying ZIP size must not bypass the actual streaming output ceiling.
    const bomb = zipSync({'Proton Pass/data.pgp': new Uint8Array(MAX_PGP_BYTES + 1)});
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    view.setUint32(22, 1, true);
    for (let offset = 0; offset < bomb.length - 28; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 1, true);
    }
    expect(() => extractProtonPgp(bomb)).toThrow();
    expect(() => extractProtonPgp(new Uint8Array([0x50, 0x4b]))).toThrow();
  });
});

function proton() {
  return {version: '1.8.0', encrypted: false, vaults: {first: {name: 'Personal', description: '', items: [
    {state: 1, createTime: 1700000000, modifyTime: 1700000001, data: {type: 'login', metadata: {name: 'Example', note: 'secret note'}, extraFields: [{fieldName: 'extra', type: 'hidden', data: {content: 'extra secret'}}], content: {itemUsername: 'someone', password: 'fixture-password', urls: ['https://example.test', 'https://second.example.test'], totpUri: 'fixture-totp', passkeys: [{keyId: 'fixture-passkey'}]}}},
    {state: 2, data: {type: 'login'}},
    {state: 1, data: {type: 'note', metadata: {name: 'Note', note: 'secret note body'}, content: {}}},
  ]}, second: {name: 'Client', items: [{state: 1, data: {type: 'identity', metadata: {name: 'Example', note: ''}, content: {fullName: 'Fixture Name'}}}]}}};
}

describe('Proton Pass JSON conversion', () => {
  it('retains vaults, passwords, notes, TOTP and original fields without enabling access or rotation', () => {
    const converted = convertProtonPass(JSON.stringify(proton()));
    const document = JSON.parse(converted.text);
    expect(document.collections).toHaveLength(2);
    expect(document.entries).toHaveLength(3);
    expect(document.entries.map((entry: {name: string}) => entry.name)).toEqual(['Example', 'Note', 'Example (Client)']);
    expect(document.entries[0]).toMatchObject({username: 'someone', value: 'fixture-password', url: 'https://example.test', category: 'login', auto_rotate: false, destination_patterns: []});
    expect(document.entries[0].custom_fields).toContainEqual({label: 'TOTP', value: 'fixture-totp', secret: true});
    expect(document.entries[0].custom_fields.every((field: {secret: boolean}) => field.secret)).toBe(true);
    const preserved = document.entries[0].custom_fields.filter((field: {label: string}) => field.label.startsWith('Proton Pass source ')).map((field: {value: string}) => field.value).join('');
    expect(JSON.parse(preserved)).toEqual(proton().vaults.first.items[0]);
    expect(document.entries[1].value).toBe('secret note body');
    expect(converted.warnings.join(' ')).toMatch(/1 trashed items/);
    expect(converted.warnings.join(' ')).toMatch(/passkeys.*source data/);
  });

  it('refuses attachments and missing or unsupported source shapes', () => {
    const data = proton();
    Object.assign(data.vaults.first.items[0], {files: ['attachment']});
    expect(() => convertProtonPass(JSON.stringify(data))).toThrow(/Attachments/);
    expect(() => convertProtonPass('{"version":"1","vaults":[]}')).toThrow();
    expect(() => convertProtonPass('{"version":"1","vaults":{}}')).toThrow(/No active/);
    expect(() => convertProtonPass('{"encrypted":true,"version":"1","vaults":{}}')).toThrow(/still encrypted/);
  });
});
