import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import type { Collection } from '@/lib/types';

vi.mock('@/components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' }, isAdmin: false, isVaultOnly: false }),
}));
const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), remove: vi.fn(), createCollection: vi.fn(), create: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: async () => ({}),
    api: {
      ...actual.api,
      system: { health: async () => ({ status: 'ok', ingress: 'public', private_ingress_enabled: false }) },
      collections: {
        ...actual.api.collections,
        list: mocks.list,
        get: mocks.get,
        remove: mocks.remove,
        create: mocks.createCollection,
        listMembers: async () => [],
        listPendingInvites: async () => [],
      },
    },
  };
});
vi.mock('@/lib/vault-types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/vault-types')>();
  return { ...actual, vaultApi: { ...actual.vaultApi, list: async () => [], unlock: async () => [], create: mocks.create } };
});
import Vault from '@/pages/Vault';

const collection: Collection = {
  id: 'client-vault', name: 'Client vault', description: '', role: 'manager',
  private_access_policy: 'standard', member_count: 1, created_at: null, updated_at: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([collection]);
  mocks.get.mockResolvedValue({ ...collection, entry_count: 0 });
  mocks.remove.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({});
});
function renderVault() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Vault /></MemoryRouter></QueryClientProvider>);
}
async function manage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Client vault' }));
  await user.click(screen.getByRole('button', { name: 'Manage' }));
}
async function unlock(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('Enter your password'), 'disposable-account-password');
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByText('Vault unlocked');
}

describe('vault deletion contents check', () => {
  it('lets the manager confirm a measured empty vault', async () => {
    const user = userEvent.setup();
    renderVault();
    await manage(user);
    await user.click(screen.getByRole('button', { name: 'Delete vault' }));
    expect(await screen.findByText('Delete this empty vault?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(collection.id, 0));
  });

  it.each([undefined, -1, '0', 1.5])('refuses an unverified count %s and recovers on explicit retry', async (count) => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValueOnce({ ...collection, entry_count: count });
    renderVault();
    await manage(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('credential count could not be verified');
    await user.click(screen.getByRole('button', { name: 'Delete vault' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
    expect(screen.queryByText(/Checking vault contents/)).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry contents check' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeEnabled());
    expect(screen.getByText('Delete this empty vault?')).toBeInTheDocument();
  });

  it('shows a network failure with retry instead of waiting forever', async () => {
    const user = userEvent.setup();
    mocks.get.mockRejectedValueOnce(new ApiError('server unavailable', 503));
    renderVault();
    await manage(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('server unavailable');
    await user.click(screen.getByRole('button', { name: 'Delete vault' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry contents check' }));
    await screen.findByText('Delete this empty vault?');
  });

  it('requires another human confirmation after the server refuses a stale count', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValueOnce({ ...collection, entry_count: 1 });
    mocks.remove.mockRejectedValueOnce(new ApiError('entry_count is stale', 409));
    renderVault();
    await manage(user);
    await user.click(screen.getByRole('button', { name: 'Delete vault' }));
    await screen.findByText('Delete this vault and its 1 credential? This cannot be undone.');
    mocks.get.mockResolvedValue({ ...collection, entry_count: 2 });
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await screen.findByRole('button', { name: 'Delete vault' });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Delete vault' }));
    await screen.findByText('Delete this vault and its 2 credentials? This cannot be undone.');
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenLastCalledWith(collection.id, 2));
  });
});

describe('adding credentials to a chosen vault', () => {
  it('explains Personal and saves into the selected vault even if the filter changes mid-draft', async () => {
    const user = userEvent.setup();
    renderVault();
    expect(screen.getByText(/Personal is your built-in vault/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Client vault' }));
    await unlock(user);
    await user.click(screen.getByRole('button', { name: 'Add credential' }));
    const form = screen.getByRole('form', { name: 'Add credential' });
    expect(within(form).getByLabelText('Vault')).toHaveValue(collection.id);
    await user.type(within(form).getByPlaceholderText('e.g. DB_PASSWORD'), 'Disposable API key');
    await user.type(within(form).getByLabelText('Secret value'), 'disposable-fixture-value');
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    expect(within(form).getByLabelText('Vault')).toHaveValue(collection.id);
    await user.click(within(form).getByRole('button', { name: 'Save credential' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ collection_id: collection.id }), expect.anything()));
  });

  it('defaults a new Personal credential to Personal', async () => {
    const user = userEvent.setup();
    renderVault();
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    await unlock(user);
    await user.click(screen.getByRole('button', { name: 'Add credential' }));
    expect(screen.getByLabelText('Vault')).toHaveValue('');
    expect(screen.getByText('Add to Personal')).toBeInTheDocument();
  });

  it('opens the credential form in the newly created vault', async () => {
    const user = userEvent.setup();
    const created = { ...collection, id: 'new-vault', name: 'New client' };
    mocks.createCollection.mockImplementation(async () => {
      mocks.list.mockResolvedValue([collection, created]);
      return created;
    });
    renderVault();
    await unlock(user);
    await user.click(screen.getByRole('button', { name: 'New vault' }));
    await user.type(screen.getByPlaceholderText('e.g. Payments team'), created.name);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Add to New client')).toBeInTheDocument();
    expect(screen.getByLabelText('Vault')).toHaveValue(created.id);
  });

  it('keeps a viewer from accidentally adding a Personal credential while viewing a read-only vault', async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue([{ ...collection, role: 'viewer' }]);
    renderVault();
    await user.click(await screen.findByRole('button', { name: 'Client vault' }));
    await unlock(user);
    expect(screen.getByRole('button', { name: 'Add credential' })).toBeDisabled();
    expect(screen.getByText(/You have read-only access/)).toBeInTheDocument();
  });

  it('preserves a credential draft and its destination when another vault is created', async () => {
    const user = userEvent.setup();
    const created = { ...collection, id: 'new-vault', name: 'Another client' };
    mocks.createCollection.mockImplementation(async () => {
      mocks.list.mockResolvedValue([collection, created]);
      return created;
    });
    renderVault();
    await user.click(await screen.findByRole('button', { name: 'Client vault' }));
    await unlock(user);
    await user.click(screen.getByRole('button', { name: 'Add credential' }));
    await user.type(screen.getByPlaceholderText('e.g. DB_PASSWORD'), 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'New vault' }));
    await user.type(screen.getByPlaceholderText('e.g. Payments team'), created.name);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('button', { name: created.name });
    expect(screen.getByPlaceholderText('e.g. DB_PASSWORD')).toHaveValue('Keep this draft');
    expect(screen.getByLabelText('Vault')).toHaveValue(collection.id);
  });
});
