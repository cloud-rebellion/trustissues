import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { exportMock, encryptMock } = vi.hoisted(() => ({ exportMock: vi.fn(), encryptMock: vi.fn() }));
vi.mock('@/lib/vault-pgp', () => ({ encryptVaultExport: encryptMock }));

vi.mock('@/lib/vault-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vault-types')>();
  return {
    ...actual,
    vaultApi: { ...actual.vaultApi, export: exportMock },
  };
});

import VaultExportModal, {
  exportFilename,
} from '@/components/VaultExportModal';

function Harness() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open export
      </button>
      <VaultExportModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

describe('vault export', () => {
  const downloads: Array<{ href: string; filename: string }> = [];

  beforeEach(() => {
    downloads.length = 0;
    exportMock.mockReset();
    encryptMock.mockReset();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:trustissues-export'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        downloads.push({ href: this.href, filename: this.download });
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prominently warns that the download contains plaintext secrets', () => {
    render(<Harness />);

    expect(
      screen.getByText('The downloaded file contains plaintext secrets.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Anyone who can open it can read every exported password/i)
    ).toBeInTheDocument();
  });

  it('shows a wrong-password error and does not download anything', async () => {
    exportMock.mockRejectedValue(new Error('Incorrect password'));
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Account password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Download export' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
    expect(downloads).toEqual([]);
    expect(screen.getByLabelText('Account password')).toHaveValue('');
  });

  it('downloads the returned Blob using the Content-Disposition filename', async () => {
    const blob = new Blob(['{"version":1}'], { type: 'application/json' });
    exportMock.mockResolvedValue({
      blob,
      contentDisposition: 'attachment; filename="team-vault.json"',
    });
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Account password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Download export' }));

    await waitFor(() => expect(downloads).toEqual([
      { href: 'blob:trustissues-export', filename: 'team-vault.json' },
    ]));
    expect(exportMock).toHaveBeenCalledWith(
      'correct-password',
      expect.any(AbortSignal)
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:trustissues-export');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses a deterministic safe fallback when no filename is supplied', () => {
    expect(exportFilename(null)).toBe('trustissues-vault-export.json');
    expect(exportFilename('attachment')).toBe('trustissues-vault-export.json');
    expect(
      exportFilename("attachment; filename*=UTF-8''Team%20Vault.json")
    ).toBe('Team Vault.json');
    expect(exportFilename('attachment; filename="../vault.json"')).toBe(
      '.._vault.json'
    );
  });

  async function requestPgp(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText('Export format'), 'pgp');
    await user.type(screen.getByLabelText('PGP passphrase'), 'fixture-encryption-passphrase');
    await user.type(screen.getByLabelText('Confirm PGP passphrase'), 'fixture-encryption-passphrase');
    await user.type(screen.getByLabelText('Account password'), 'account-password');
    await user.click(screen.getByRole('button', { name: 'Download export' }));
  }

  it('downloads only encrypted bytes and keeps the PGP passphrase out of the export API request', async () => {
    const plaintext = new Blob(['private-fixture'], {type: 'application/json'});
    const ciphertext = new Blob(['armored-fixture'], {type: 'application/pgp-encrypted'});
    exportMock.mockResolvedValue({blob: plaintext, contentDisposition: null});
    encryptMock.mockResolvedValue(ciphertext);
    const user = userEvent.setup();
    render(<Harness />);
    await requestPgp(user);
    await waitFor(() => expect(downloads[0]?.filename).toBe('trustissues-vault-export.json.asc'));
    expect(vi.mocked(URL.createObjectURL).mock.calls[0][0]).toBe(ciphertext);
    expect(exportMock).toHaveBeenCalledWith('account-password', expect.any(AbortSignal));
    expect(encryptMock).toHaveBeenCalledWith(plaintext, expect.objectContaining({passphrase: 'fixture-encryption-passphrase'}), expect.any(AbortSignal));
  });

  it('never falls back to a plaintext download if encryption fails', async () => {
    exportMock.mockResolvedValue({blob: new Blob(['private-fixture']), contentDisposition: null});
    encryptMock.mockRejectedValue(new Error('PGP encryption failed'));
    const user = userEvent.setup();
    render(<Harness />);
    await requestPgp(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('PGP encryption failed');
    expect(downloads).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancels in-flight encryption and ignores its late result after closing', async () => {
    let finish!: (value: Blob) => void;
    exportMock.mockResolvedValue({blob: new Blob(['private-fixture']), contentDisposition: null});
    encryptMock.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<Harness />);
    await requestPgp(user);
    await waitFor(() => expect(encryptMock).toHaveBeenCalled());
    const signal = encryptMock.mock.calls[0][2] as AbortSignal;
    await user.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(signal.aborted).toBe(true);
    finish(new Blob(['late ciphertext']));
    await user.click(screen.getByRole('button', {name: 'Open export'}));
    expect(screen.getByLabelText('Account password')).toHaveValue('');
    expect(downloads).toHaveLength(0);
  });

  it('clears the password when closed and after a successful export', async () => {
    const user = userEvent.setup();
    exportMock.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      contentDisposition: null,
    });
    render(<Harness />);

    const password = screen.getByLabelText('Account password');
    await user.type(password, 'close-me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Open export' }));
    expect(screen.getByLabelText('Account password')).toHaveValue('');

    await user.type(screen.getByLabelText('Account password'), 'download-me');
    await user.click(screen.getByRole('button', { name: 'Download export' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open export' }));
    expect(screen.getByLabelText('Account password')).toHaveValue('');
  });
});
