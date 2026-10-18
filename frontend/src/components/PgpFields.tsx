import { useEffect, useRef, useState } from 'react';
import { MAX_PGP_KEY_BYTES, type PgpOptions } from '@/lib/vault-pgp-types';

export const EMPTY_PGP_OPTIONS: PgpOptions = { mode: 'passphrase', passphrase: '', key: '' };

export default function PgpFields({ direction, value, onChange, disabled }: {
  direction: 'import' | 'export'; value: PgpOptions;
  onChange: (value: PgpOptions) => void; disabled: boolean;
}) {
  const [fileError, setFileError] = useState('');
  const generation = useRef(0);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => () => { generation.current++; }, []);
  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50';
  const importing = direction === 'import';
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-slate-200 p-4">
    <legend className="px-1 text-sm font-medium text-slate-700">PGP {importing ? 'decryption' : 'encryption'}</legend>
    <label className="block space-y-1 text-sm text-slate-700">
      <span>{importing ? 'Decrypt using' : 'Encrypt using'}</span>
      <select className={inputClass} value={value.mode} onChange={(event) => {
        generation.current++;
        setFileError('');
        onChange({ ...EMPTY_PGP_OPTIONS, mode: event.target.value as PgpOptions['mode'] });
      }}>
        <option value="passphrase">Passphrase</option>
        <option value="key">{importing ? 'Private key' : 'Recipient public key'}</option>
      </select>
    </label>
    {value.mode === 'key' && <>
      <label className="block space-y-1 text-sm text-slate-700">
        <span>{importing ? 'Armored private key file (.asc)' : 'Armored public key file (.asc)'}</span>
        <input type="file" accept=".asc,text/plain,application/pgp-keys" className={inputClass}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            const request = ++generation.current;
            onChange({ ...value, key: '' });
            setFileError('');
            if (!file) return;
            if (file.size > MAX_PGP_KEY_BYTES) { setFileError('PGP keys must be 256KB or smaller.'); return; }
            try {
              const key = await file.text();
              if (request !== generation.current) return;
              onChange({ ...latest.current, key });
            } catch { if (request === generation.current) setFileError('Could not read the key file.'); }
          }} />
      </label>
      {!importing && <label className="block space-y-1 text-sm text-slate-700">
        <span>Or paste recipient public key</span>
        <textarea className={`${inputClass} font-mono text-xs`} rows={3} spellCheck={false} autoComplete="off"
          maxLength={MAX_PGP_KEY_BYTES} value={value.key} onChange={(event) => {
            generation.current++;
            setFileError('');
            onChange({ ...value, key: event.target.value });
          }} />
      </label>}
    </>}
    {(value.mode === 'passphrase' || importing) && <label className="block space-y-1 text-sm text-slate-700">
      <span>{value.mode === 'key' ? 'Private key passphrase (if protected)' : 'PGP passphrase'}</span>
      <input type="password" className={inputClass} value={value.passphrase} autoComplete="off"
        required={value.mode === 'passphrase'} minLength={!importing && value.mode === 'passphrase' ? 12 : undefined}
        onChange={(event) => onChange({ ...value, passphrase: event.target.value })} />
    </label>}
    {fileError && <p role="alert" className="text-sm text-red-700">{fileError}</p>}
    <p className="text-xs leading-5 text-slate-500">
      {importing
        ? 'For Proton Pass, use the passphrase chosen when exporting. Decryption happens in your browser; your PGP key and passphrase are not uploaded. Decrypted data goes to TrustIssues for validation and import. Sender signatures are not verified.'
        : value.mode === 'key'
          ? 'Check the recipient key fingerprint in your PGP tool before exporting. Keep the matching private key to decrypt this file.'
          : 'Use a separate passphrase of at least 12 characters and keep it safe. You will need it to import this file.'}
    </p>
  </fieldset>;
}
