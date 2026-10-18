// @vitest-environment node
import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { convertProtonCsv } from '@/lib/proton-pass-csv';
import { prepareVaultImport } from '@/lib/vault-pgp';
const EMPTY_PGP_OPTIONS = {mode: 'passphrase' as const, key: '', passphrase: ''};

const fields = ['type', 'name', 'url', 'autofillUrls', 'email', 'username', 'password', 'note', 'totp', 'createTime', 'modifyTime', 'vault'];
function fixture() {
  return '\uFEFF' + Papa.unparse({fields, data: [
    ['login', 'Same title', 'https://example.test, https://second.example.test', JSON.stringify([{url: 'https://example.test', mode: 0}, {url: 'https://second.example.test', mode: 1}]), 'person@example.test', '', '  exact password  ', 'line 1, with comma\nline "2"', 'otpauth://fixture', '1700000000', '1700000001', 'Personal'],
    ['note', 'Secure note', '', '', '', '', '', 'NOTE_BODY_PRIVATE', '', '', '', 'Personal'],
    ['login', 'Same title', '', '', '', 'username', 'OTHER_PASSWORD_PRIVATE', '', '', '', '', 'Client'],
    ['identity', 'Identity', '', '', '', '', '', '{"fullName":"Fixture Person","note":"Identity note"}', '', '', '', 'Client'],
  ]});
}
describe('Proton CSV migration', () => {
  it('detects the source schema, preserves vaults and exact cells, and keeps notes/TOTP secret', () => {
    const converted = convertProtonCsv(fixture());
    expect(converted).not.toBeNull();
    const document = JSON.parse(converted!.text);
    expect(document.collections.map((collection: {name: string}) => collection.name)).toEqual(['Personal', 'Client']);
    expect(document.entries).toHaveLength(4);
    expect(document.entries.map((entry: {name: string}) => entry.name)).toEqual(['Same title', 'Secure note', 'Same title (Client)', 'Identity']);
    expect(document.entries[0]).toMatchObject({value: '  exact password  ', username: 'person@example.test', url: 'https://example.test', created_at: '2023-11-14T22:13:20.000Z'});
    expect(document.entries[1].value).toBe('NOTE_BODY_PRIVATE');
    expect(document.entries[0].custom_fields).toContainEqual({label: 'TOTP', value: 'otpauth://fixture', secret: true});
    const source = JSON.parse(document.entries[0].custom_fields.filter((field: {label: string}) => field.label.startsWith('Proton Pass source')).map((field: {value: string}) => field.value).join(''));
    expect(source.csv_fields.note).toBe('line 1, with comma\nline "2"');
    expect(JSON.parse(source.csv_fields.autofillurls)).toHaveLength(2);
    expect(converted!.warnings.join(' ')).toMatch(/CSV omits some item details/);
    expect(document.entries.every((entry: {destination_patterns: unknown[]; auto_rotate: boolean}) => !entry.destination_patterns.length && !entry.auto_rotate)).toBe(true);
  });

  it('prepares Proton CSV into the native file path while leaving other CSVs unchanged', async () => {
    const file = new File([fixture()], 'proton.csv', {type: 'text/csv'});
    const result = await prepareVaultImport(file, EMPTY_PGP_OPTIONS, new AbortController().signal);
    expect(result.file.name).toBe('proton-pass-converted.json');
    expect(JSON.parse(await result.file.text()).entries).toHaveLength(4);
    const other = new File(['url,username,password,extra,name\nhttps://example.test,user,pass,,Example'], 'lastpass.csv');
    expect((await prepareVaultImport(other, EMPTY_PGP_OPTIONS, new AbortController().signal)).file).toBe(other);
  });

  it('rejects malformed, duplicate-header and excessive files without a partial conversion', () => {
    expect(() => convertProtonCsv('type,name,password,note,totp,vault\nlogin,Example,password,"unclosed,,Personal')).toThrow(/malformed/);
    expect(() => convertProtonCsv('type,name,password,note,totp,vault,name\nlogin,A,p,,,V,B')).toThrow(/duplicate/);
    expect(() => convertProtonCsv('type,name,password,note,totp,vault\nlogin,A,p,,,V,extra')).toThrow(/inconsistent/);
    expect(() => convertProtonCsv('name,password\nA,p', true)).toThrow(/expected Proton Pass/);
    expect(() => convertProtonCsv('type,name,password,note,totp,vault\n' + 'login,A,p,,,V\n'.repeat(5001))).toThrow(/5000/);
  });

  it('does not mistake a LastPass or overlapping header substring for Proton', () => {
    expect(convertProtonCsv('url,username,password,extra,name\nhttps://example.test,u,p,,A')).toBeNull();
    expect(convertProtonCsv('not_type,name,password,note,totp,vault\nlogin,A,p,,,V')).toBeNull();
  });
});
