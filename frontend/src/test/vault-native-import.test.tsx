import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  csvConfirmMock,
  csvPreviewMock,
  nativeConfirmMock,
  nativePreviewMock,
  prepareMock,
} = vi.hoisted(() => ({
  csvConfirmMock: vi.fn(),
  csvPreviewMock: vi.fn(),
  nativeConfirmMock: vi.fn(),
  nativePreviewMock: vi.fn(),
  prepareMock: vi.fn(),
}));

vi.mock('@/lib/vault-pgp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vault-pgp')>();
  return { ...actual, prepareVaultImport: prepareMock };
});

vi.mock('@/lib/vault-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vault-types')>();
  return {
    ...actual,
    vaultApi: {
      ...actual.vaultApi,
      importConfirm: csvConfirmMock,
      importPreview: csvPreviewMock,
      nativeImportConfirm: nativeConfirmMock,
      nativeImportPreview: nativePreviewMock,
    },
  };
});

import VaultImportModal from '@/components/VaultImportModal';
import { ApiError } from '@/lib/api';

const nativePreview = {
  format: 'trustissues-vault',
  version: 1,
  entry_count: 3,
  collection_count: 2,
  conflicts: [] as string[],
  auto_rotate_disabled: 1,
};

function Harness({ onComplete = vi.fn() }: { onComplete?: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open import
      </button>
      <VaultImportModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onImportComplete={onComplete}
      />
    </>
  );
}

function trustIssuesFile() {
  return new File(
    ['{"format":"trustissues-vault","version":1,"value":"DO_NOT_RENDER_SECRET"}'],
    'trustissues-vault-export.json',
    { type: 'application/json' }
  );
}

async function uploadAndPreview(file = trustIssuesFile()) {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText('Choose File'), file);
  await user.click(screen.getByRole('button', { name: 'Preview Import' }));
  await screen.findByText(/TrustIssues export version/i);
  return { file, user };
}

describe('TrustIssues native vault import', () => {
  beforeEach(() => {
    csvConfirmMock.mockReset();
    csvPreviewMock.mockReset();
    nativeConfirmMock.mockReset();
    nativePreviewMock.mockReset();
    nativePreviewMock.mockResolvedValue(nativePreview);
    prepareMock.mockReset();
    prepareMock.mockImplementation(async (file: File) => ({file, warnings: []}));
  });

  it('prepares encrypted Proton Pass locally, previews and confirms the same prepared data', async () => {
    const decrypted = trustIssuesFile();
    prepareMock.mockResolvedValue({file: decrypted, warnings: ['Proton Pass fixture migration warning']});
    nativeConfirmMock.mockResolvedValue({imported: 3, collections_created: 2});
    const user = userEvent.setup();
    render(<Harness />);
    const encrypted = new File(['encrypted-fixture'], 'Proton Pass.zip', {type: 'application/zip'});
    await user.upload(screen.getByLabelText('Choose File'), encrypted);
    await user.type(screen.getByLabelText('PGP passphrase'), 'export-passphrase');
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    await screen.findByText(/TrustIssues export version/);
    expect(prepareMock).toHaveBeenCalledWith(encrypted, expect.objectContaining({passphrase: 'export-passphrase'}), expect.any(AbortSignal), 'auto');
    expect(nativePreviewMock).toHaveBeenCalledWith(decrypted, expect.any(AbortSignal));
    expect(screen.getByRole('note')).toHaveTextContent('Proton Pass fixture migration warning');
    expect(screen.queryByText('DO_NOT_RENDER_SECRET')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Current account password'), 'account-password');
    await user.click(screen.getByRole('button', {name: 'Import 3 entries'}));
    await waitFor(() => expect(nativeConfirmMock).toHaveBeenCalledWith(decrypted, 'account-password', expect.any(AbortSignal)));
    expect(csvConfirmMock).not.toHaveBeenCalled();
  });

  it('does not call preview or confirm when PGP decryption fails', async () => {
    prepareMock.mockRejectedValue(new Error('PGP decryption failed'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText('Choose File'), new File(['bad-fixture'], 'data.pgp'));
    await user.type(screen.getByLabelText('PGP passphrase'), 'wrong-passphrase');
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was imported');
    expect(nativePreviewMock).not.toHaveBeenCalled();
    expect(nativeConfirmMock).not.toHaveBeenCalled();
    expect(csvPreviewMock).not.toHaveBeenCalled();
  });

  it('cancels PGP preparation on close and ignores the late decrypted result', async () => {
    let finish!: (result: {file: File; warnings: string[]}) => void;
    prepareMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText('Choose File'), new File(['fixture'], 'data.pgp'));
    await user.type(screen.getByLabelText('PGP passphrase'), 'fixture-passphrase');
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    const signal = prepareMock.mock.calls[0][2] as AbortSignal;
    await user.click(screen.getByRole('button', {name: 'Close import'}));
    expect(signal.aborted).toBe(true);
    finish({file: trustIssuesFile(), warnings: []});
    await user.click(screen.getByRole('button', {name: 'Open import'}));
    expect(nativePreviewMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('PGP passphrase')).not.toBeInTheDocument();
  });

  it('previews JSON using counts only and warns about plaintext and disabled rotation', async () => {
    render(<Harness />);
    const file = trustIssuesFile();
    const user = userEvent.setup();

    await user.upload(screen.getByLabelText('Choose File'), file);
    expect(
      screen.getByText('This JSON file contains plaintext vault secrets.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview Import' }));

    expect(await screen.findByText(/3 entries in 2 collections/i)).toBeInTheDocument();
    expect(screen.getByText('This file contains plaintext vault secrets.')).toBeInTheDocument();
    expect(screen.getByText('Imported auto-rotation will be disabled.')).toBeInTheDocument();
    expect(screen.getByText(/1 entries requested auto-rotation/i)).toBeInTheDocument();
    expect(screen.queryByText('DO_NOT_RENDER_SECRET')).not.toBeInTheDocument();
    expect(nativePreviewMock).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(csvPreviewMock).not.toHaveBeenCalled();
  });

  it('blocks confirmation when preview reports any name conflict', async () => {
    nativePreviewMock.mockResolvedValue({
      ...nativePreview,
      conflicts: ['Existing GitHub entry'],
    });
    render(<Harness />);

    await uploadAndPreview();

    expect(screen.getByRole('alert')).toHaveTextContent('Import blocked by 1 name conflict');
    expect(screen.getByRole('alert')).toHaveTextContent('Existing GitHub entry');
    expect(screen.getByLabelText('Current account password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import 3 entries' })).toBeDisabled();
    expect(nativeConfirmMock).not.toHaveBeenCalled();
  });

  it('requires the current password and confirms by uploading the same file again', async () => {
    nativeConfirmMock.mockResolvedValue({
      imported: 3,
      collections_created: 2,
      auto_rotate_disabled: 1,
    });
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const { file, user } = await uploadAndPreview();
    const confirm = screen.getByRole('button', { name: 'Import 3 entries' });

    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Current account password'), 'correct horse');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(nativeConfirmMock).toHaveBeenCalledWith(
        file,
        'correct horse',
        expect.any(AbortSignal)
      );
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('turns a confirm-time name race back into an actionable blocked preview', async () => {
    nativeConfirmMock.mockRejectedValue(new ApiError(
      'native vault import has name conflicts',
      409,
      { conflicts: ['GitHub created after preview'] }
    ));
    render(<Harness />);
    const { user } = await uploadAndPreview();

    await user.type(screen.getByLabelText('Current account password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Import 3 entries' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Import blocked by 1 name conflict');
    expect(screen.getByRole('alert')).toHaveTextContent('GitHub created after preview');
    expect(screen.getByLabelText('Current account password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Import 3 entries' })).toBeDisabled();
  });

  it('clears the selected file and password on close and after success', async () => {
    nativeConfirmMock.mockResolvedValue({
      imported: 3,
      collections_created: 2,
      auto_rotate_disabled: 1,
    });
    render(<Harness />);
    let flow = await uploadAndPreview();

    await flow.user.type(screen.getByLabelText('Current account password'), 'close-me');
    await flow.user.click(screen.getByRole('button', { name: 'Close import' }));
    await flow.user.click(screen.getByRole('button', { name: 'Open import' }));
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();

    flow = await uploadAndPreview();
    await flow.user.type(screen.getByLabelText('Current account password'), 'success-me');
    await flow.user.click(screen.getByRole('button', { name: 'Import 3 entries' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await flow.user.click(screen.getByRole('button', { name: 'Open import' }));
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();
  });

  it('drops the password immediately and aborts confirmation when closed', async () => {
    let requestSignal: AbortSignal | undefined;
    nativeConfirmMock.mockImplementation(
      (_file: File, _password: string, signal: AbortSignal) => {
        requestSignal = signal;
        return new Promise(() => {});
      }
    );
    render(<Harness />);
    const { user } = await uploadAndPreview();

    await user.type(screen.getByLabelText('Current account password'), 'do-not-retain');
    await user.click(screen.getByRole('button', { name: 'Import 3 entries' }));

    expect(screen.getByLabelText('Current account password')).toHaveValue('');
    expect(requestSignal?.aborted).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Close import' }));
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the existing CSV preview and confirm flow', async () => {
    csvPreviewMock.mockResolvedValue({
      format: 'bitwarden',
      entries: [{
        name: 'Example login',
        url: 'https://example.test',
        username: 'person@example.test',
        value: 'csv-secret',
        category: 'login',
      }],
      conflicts: [],
      total: 1,
      skipped: [],
      source_rows: 1,
    });
    csvConfirmMock.mockResolvedValue({ imported: 1, skipped: [] });
    render(<Harness />);
    const user = userEvent.setup();
    const file = new File(['name,url,username,password'], 'bitwarden.csv', {
      type: 'text/csv',
    });

    await user.upload(screen.getByLabelText('Choose File'), file);
    await user.click(screen.getByRole('button', { name: 'Preview Import' }));

    expect(await screen.findByText('Example login')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current account password')).not.toBeInTheDocument();
    expect(csvPreviewMock).toHaveBeenCalledWith(file, 'auto', expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Import 1 entries' }));
    await waitFor(() => expect(csvConfirmMock).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Example login', value: 'csv-secret' }),
    ], expect.any(AbortSignal)));
    expect(nativeConfirmMock).not.toHaveBeenCalled();
  });

  it('renders legacy null preview arrays without crashing and still imports valid rows', async () => {
    const entry = {name: 'Legacy CSV login', url: '', username: 'fixture', value: 'fixture-secret'};
    csvPreviewMock.mockResolvedValue({format: 'lastpass', entries: [entry], total: 1, conflicts: null, skipped: null, source_rows: 1});
    csvConfirmMock.mockResolvedValue({imported: 1});
    render(<Harness />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose File'), new File(['fixture'], 'legacy.csv', {type: 'text/csv'}));
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    expect(await screen.findByText('Legacy CSV login')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Import 1 entries'}));
    await waitFor(() => expect(csvConfirmMock).toHaveBeenCalledWith([entry], expect.any(AbortSignal)));
  });

  it('renders an all-skipped legacy preview with null entries and disables import', async () => {
    csvPreviewMock.mockResolvedValue({format: 'bitwarden', entries: null, total: 0, conflicts: null,
      skipped: [{name: 'Skipped card', reason: 'unsupported item'}], source_rows: 1});
    render(<Harness />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose File'), new File(['fixture'], 'legacy.csv', {type: 'text/csv'}));
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    expect(await screen.findByText('Skipped card')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Import 0 entries'})).toBeDisabled();
  });

  it('reports incomplete positive-count preview data instead of crashing or claiming it is empty', async () => {
    csvPreviewMock.mockResolvedValue({format: 'lastpass', entries: null, total: 2, conflicts: null, skipped: []});
    render(<Harness />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose File'), new File(['fixture'], 'legacy.csv', {type: 'text/csv'}));
    await user.click(screen.getByRole('button', {name: 'Preview Import'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('preview was incomplete');
    expect(csvConfirmMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: /Import \d+ entries/})).not.toBeInTheDocument();
  });
});
