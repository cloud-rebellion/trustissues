import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@/lib/types';

const auth = vi.hoisted(() => ({
  user: null as User | null,
  isLoading: false,
  setupRequired: false,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    ...auth,
    isAdmin: auth.user?.role === 'admin',
    isVaultOnly: auth.user?.role === 'vault_only',
    logout: vi.fn(),
  }),
}));

// Keep App's actual routes and guard. These destination stubs make redirects
// observable without starting unrelated login/setup HTTP requests.
vi.mock('@/pages/Login', () => ({
  default: () => <h1>Sign in destination</h1>,
}));
vi.mock('@/pages/Setup', () => ({ default: () => <h1>Setup destination</h1> }));

import App from '@/App';

const guide = `# Your first vault

## Move from Proton Pass

Preserve your credentials while choosing a destination vault.

[Read encrypted import details](PGP-IMPORT-EXPORT.md#supported-formats)

[Jump to sharing](#sharing-with-clients)

![Fictional vault](screenshots/user-guide/04-vault-overview.png)

## Sharing with clients

Use the correct role for each teammate.
`;

const pgpGuide = `# Encrypted imports

## Supported formats

Proton Pass migration uses your exported file.

[Return to your first vault](USER-GUIDE.md#move-from-proton-pass)
`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function LocationProbe() {
  const { pathname, hash } = useLocation();
  return (
    <span aria-label="Current route">
      {pathname}
      {hash}
    </span>
  );
}

const clients: QueryClient[] = [];
function renderApp(path = '/documentation') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  auth.user = {
    id: 'documentation-user',
    email: 'reader@example.test',
    name: 'Guide reader',
    role: 'user',
    totp_enabled: true,
    created_at: '2026-10-18T12:00:00Z',
  };
  auth.isLoading = false;
  auth.setupRequired = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    if (path === '/api/documentation/docs/USER-GUIDE.md')
      return json({ content: guide });
    if (path === '/api/documentation/docs/PGP-IMPORT-EXPORT.md')
      return json({ content: pgpGuide });
    throw new Error(`Unexpected documentation page request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('print', vi.fn());
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('documentation is a reachable authenticated application page', () => {
  it.each(['admin', 'user', 'vault_only'] as const)(
    'allows the %s role to use the sidebar and open a guide',
    async (role) => {
      auth.user = { ...auth.user!, role };
      const user = userEvent.setup();
      renderApp('/documentation/user-guide');

      expect(
        await screen.findByRole('heading', { name: 'Your first vault' }),
      ).toBeInTheDocument();
      const sidebarLink = screen.getByRole('link', { name: 'Documentation' });
      expect(sidebarLink).toHaveAttribute('href', '/documentation');
      expect(sidebarLink).toHaveAttribute('aria-current', 'page');
      await user.click(sidebarLink);
      expect(
        await screen.findByRole('heading', {
          name: 'Start with your first credential',
        }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Current route')).toHaveTextContent(
        '/documentation',
      );
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        '/api/documentation/docs/USER-GUIDE.md',
      ]);
    },
  );

  it('redirects anonymous visitors to sign in without fetching a guide', async () => {
    auth.user = null;
    renderApp('/documentation/user-guide');
    expect(
      await screen.findByRole('heading', { name: 'Sign in destination' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps first-run setup and loading ahead of guide requests', async () => {
    auth.setupRequired = true;
    const view = renderApp('/documentation/user-guide');
    expect(
      await screen.findByRole('heading', { name: 'Setup destination' }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();

    auth.setupRequired = false;
    auth.isLoading = true;
    renderApp('/documentation/user-guide');
    expect(
      screen.queryByRole('heading', { name: 'Your first vault' }),
    ).toBeNull();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/documentation/user-guide',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers instructions during mandatory 2FA enrollment without touching vault APIs', async () => {
    auth.user = {
      ...auth.user!,
      role: 'vault_only',
      totp_enabled: false,
      totp_enrollment_required: true,
    };
    renderApp('/documentation/user-guide');

    expect(
      await screen.findByRole('heading', { name: 'Your first vault' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Two-factor authentication is required.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set it up now' })).toHaveAttribute(
      'href',
      '/settings?tab=account',
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/documentation/docs/USER-GUIDE.md',
    ]);
  });
});

describe('reading and finding guides', () => {
  it('finds the migration guides by Proton and gives a useful empty result', async () => {
    const user = userEvent.setup();
    renderApp();
    const search = await screen.findByRole('searchbox', {
      name: 'Search guides',
    });
    await user.type(search, 'Proton');
    expect(
      screen.getByRole('link', { name: /Using TrustIssues/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /PGP and Proton Pass/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Administrator lockout/ }),
    ).toBeNull();
    await user.clear(search);
    await user.type(search, 'unfindable guide xyz');
    expect(screen.getByRole('status')).toHaveTextContent('No guides match');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows cross-guide links, bookmarks, and local screenshot URLs', async () => {
    const user = userEvent.setup();
    renderApp('/documentation/user-guide');
    expect(
      await screen.findByRole('heading', { name: 'Your first vault' }),
    ).toBeInTheDocument();
    const image = screen.getByRole('img', { name: 'Fictional vault' });
    expect(image).toHaveAttribute(
      'src',
      '/api/documentation/docs/screenshots/user-guide/04-vault-overview.png',
    );
    expect(image.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');

    const outline = screen.getByRole('navigation', { name: 'On this page' });
    await user.click(
      within(outline).getByRole('link', { name: 'Sharing with clients' }),
    );
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/documentation/user-guide#sharing-with-clients',
    );
    expect(
      screen.getByRole('heading', { name: 'Sharing with clients' }),
    ).toHaveAttribute('id', 'sharing-with-clients');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await user.click(
      screen.getByRole('link', { name: 'Read encrypted import details' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Encrypted imports' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/documentation/pgp#supported-formats',
    );
    expect(
      screen.getByRole('heading', { name: 'Supported formats' }),
    ).toHaveAttribute('id', 'supported-formats');
    await user.click(
      screen.getByRole('link', { name: 'Return to your first vault' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Your first vault' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/documentation/user-guide#move-from-proton-pass',
    );
  });

  it('renders an actionable retry after an unavailable guide', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'unavailable' }, 503));
    const user = userEvent.setup();
    renderApp('/documentation/user-guide');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This guide could not be loaded',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { name: 'Your first vault' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps permission tables and credential flow diagrams readable, with stable bookmarks and printing', async () => {
    fetchMock.mockResolvedValue(
      json({
        content: `# Automation reference

## Credential flow

| Role | Permission |
| --- | --- |
| Viewer | Read shared credentials |

\`\`\`mermaid
sequenceDiagram
participant IDE as Your IDE
participant Broker as Credential broker
IDE->>Broker: Request an approved action
Broker-->>IDE: Return only the action result
\`\`\`

## Credential flow

The repeated heading still has its own bookmark.
`,
      }),
    );
    const user = userEvent.setup();
    renderApp('/documentation/user-guide');
    expect(
      await screen.findByRole('heading', { name: 'Automation reference' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent(
      'ViewerRead shared credentials',
    );
    const flow = screen.getByRole('figure');
    expect(within(flow).getAllByRole('listitem')).toHaveLength(2);
    expect(flow).toHaveTextContent('Your IDE');
    expect(flow).toHaveTextContent('Credential broker');
    expect(flow).toHaveTextContent('Request an approved action');
    expect(flow).toHaveTextContent('Return only the action result');
    const headings = screen.getAllByRole('heading', {
      name: 'Credential flow',
    });
    expect(headings.map((heading) => heading.id)).toEqual([
      'credential-flow',
      'credential-flow-1',
    ]);
    const outline = screen.getByRole('navigation', { name: 'On this page' });
    expect(
      within(outline)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/documentation/user-guide#credential-flow',
      '/documentation/user-guide#credential-flow-1',
    ]);
    await user.click(screen.getByRole('button', { name: 'Print guide' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown guide links in documentation and does not fetch arbitrary paths', async () => {
    const user = userEvent.setup();
    renderApp('/documentation/unrecognized');
    expect(
      await screen.findByRole('heading', { name: 'Guide not found' }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Browse all guides' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Start with your first credential',
      }),
    ).toBeInTheDocument();
  });
});

describe('rendered documentation keeps unsafe content inert', () => {
  it('excludes HTML, active links, remote images and unlisted files while retaining safe external references', async () => {
    fetchMock.mockResolvedValue(
      json({
        content: `# Safe reference

<script>window.documentationCompromised = true</script>
<iframe src="https://collector.example.test"></iframe>
<img src="https://collector.example.test/html.png" onerror="alert(1)">

[Run code](javascript:alert%281%29)
[Inline data](data:text/html,unsafe)
[Unknown local file](../../private/admin.txt)
![External tracker](https://collector.example.test/pixel.png)
![Traversal image](../../private/admin.png)
![Unknown screenshot](screenshots/user-guide/99-fake.png)

[OpenPGP reference](https://openpgpjs.org/)
`,
      }),
    );
    const view = renderApp('/documentation/user-guide');
    expect(
      await screen.findByRole('heading', { name: 'Safe reference' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(view.container.querySelector('article')).toBeInTheDocument(),
    );
    const article = view.container.querySelector('article')!;
    expect(article.querySelector('script, iframe, img')).toBeNull();
    expect(
      within(article).queryByRole('link', { name: 'Run code' }),
    ).toBeNull();
    expect(
      within(article).queryByRole('link', { name: 'Inline data' }),
    ).toBeNull();
    expect(
      within(article).queryByRole('link', { name: 'Unknown local file' }),
    ).toBeNull();
    expect(within(article).getByText('External tracker')).toBeInTheDocument();
    const external = within(article).getByRole('link', {
      name: 'OpenPGP reference',
    });
    expect(external).toHaveAttribute('href', 'https://openpgpjs.org/');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/documentation/docs/USER-GUIDE.md',
    ]);
  });
});
