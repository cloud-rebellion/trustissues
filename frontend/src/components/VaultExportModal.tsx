import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ApiError } from '@/lib/api';
import { vaultApi } from '@/lib/vault-types';
import PgpFields, { EMPTY_PGP_OPTIONS } from './PgpFields';
import { encryptVaultExport } from '@/lib/vault-pgp';

interface VaultExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FALLBACK_EXPORT_FILENAME = 'trustissues-vault-export.json';

function safeFilename(value: string): string {
  // A response header must not be able to turn the download into a path or a
  // control-character-laden filename. Keep the server's name, but flatten it.
  return value
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

export function exportFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return FALLBACK_EXPORT_FILENAME;

  // Prefer RFC 5987's UTF-8 filename when both forms are present.
  const encoded = contentDisposition.match(
    /filename\*\s*=\s*UTF-8''(?:"([^"]+)"|([^;]+))/i
  );
  if (encoded) {
    try {
      const decoded = safeFilename(
        decodeURIComponent((encoded[1] ?? encoded[2]).trim())
      );
      if (decoded) return decoded;
    } catch {
      // Fall through to the ordinary filename or the deterministic fallback.
    }
  }

  const ordinary = contentDisposition.match(
    /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i
  );
  if (ordinary) {
    const filename = safeFilename((ordinary[1] ?? ordinary[2]).trim());
    if (filename) return filename;
  }

  return FALLBACK_EXPORT_FILENAME;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'The vault could not be exported. Please try again.';
}

function download(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export default function VaultExportModal({
  isOpen,
  onClose,
}: VaultExportModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [format, setFormat] = useState<'json' | 'pgp'>('json');
  const [pgp, setPgp] = useState(EMPTY_PGP_OPTIONS);
  const [confirmation, setConfirmation] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  function clearSensitiveState() {
    setPassword('');
    setError(null);
    setIsExporting(false);
    setPgp(EMPTY_PGP_OPTIONS);
    setConfirmation('');
    setFormat('json');
  }

  function close() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    clearSensitiveState();
    onClose();
  }

  useEffect(() => {
    if (!isOpen) {
      activeRequest.current?.abort();
      activeRequest.current = null;
      clearSensitiveState();
    }

    return () => {
      activeRequest.current?.abort();
    };
  }, [isOpen]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || isExporting) return;
    if (format === 'pgp' && (
      pgp.mode === 'key' ? !pgp.key : pgp.passphrase.length < 12 || pgp.passphrase !== confirmation
    )) {
      setError('Supply a public key or matching PGP passphrases of at least 12 characters.');
      return;
    }

    const submittedPassword = password;
    const protection = { ...pgp };
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setPassword('');
    setPgp(EMPTY_PGP_OPTIONS);
    setConfirmation('');
    setError(null);
    setIsExporting(true);

    try {
      const result = await vaultApi.export(submittedPassword, controller.signal);
      if (controller.signal.aborted || activeRequest.current !== controller) return;

      const blob = format === 'pgp'
        ? await encryptVaultExport(result.blob, protection, controller.signal)
        : result.blob;
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      const filename = exportFilename(result.contentDisposition);
      download(blob, format === 'pgp' ? `${filename}.asc` : filename);
      activeRequest.current = null;
      setIsExporting(false);
      toast.success('Vault export downloaded');
      close();
    } catch (exportError: unknown) {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      activeRequest.current = null;
      setIsExporting(false);
      setError(errorMessage(exportError));
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close export dialog"
        className="absolute inset-0 cursor-default bg-slate-900/50"
        onClick={close}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-export-title"
        aria-describedby="vault-export-warning"
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2
              id="vault-export-title"
              className="text-lg font-semibold text-slate-900"
            >
              Export vault
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Re-enter your account password to continue.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close export dialog"
            onClick={close}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div
            id="vault-export-warning"
            className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {format === 'pgp' ? 'The downloaded file will be PGP-encrypted.' : 'The downloaded file contains plaintext secrets.'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                {format === 'pgp'
                  ? 'Encryption happens in your browser before download. Keep the decryption key or passphrase safe; TrustIssues cannot recover it.'
                  : 'Anyone who can open it can read every exported password. Store it securely and delete it when you are finished.'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-800">
                An export made on the public URL contains only personal and
                standard/client vaults. Use your team&apos;s private Tailscale or
                Headscale URL when you need a complete export that includes
                protected internal collections. The file records which scope
                produced it.
              </p>
            </div>
          </div>

          <label className="block space-y-1 text-sm font-medium text-slate-700">
            <span>Export format</span>
            <select value={format} disabled={isExporting}
              onChange={(event) => { setFormat(event.target.value as 'json' | 'pgp'); setPgp(EMPTY_PGP_OPTIONS); setConfirmation(''); setError(null); }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="json">TrustIssues JSON (plaintext)</option>
              <option value="pgp">PGP-encrypted TrustIssues JSON (.asc)</option>
            </select>
          </label>
          {format === 'pgp' && <>
            <PgpFields direction="export" value={pgp} onChange={setPgp} disabled={isExporting} />
            {pgp.mode === 'passphrase' && <label className="block space-y-1 text-sm text-slate-700">
              <span>Confirm PGP passphrase</span>
              <input type="password" required minLength={12} autoComplete="off" value={confirmation} disabled={isExporting}
                onChange={(event) => setConfirmation(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>}
          </>}

          <div>
            <label
              htmlFor="vault-export-password"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Account password
            </label>
            <input
              id="vault-export-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError(null);
              }}
              disabled={isExporting}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-hidden focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || isExporting}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isExporting ? 'Exporting…' : 'Download export'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
