import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  Loader2,
  Printer,
  Search,
} from 'lucide-react';
import Layout from '@/components/Layout';
import GuideContent from '@/components/GuideContent';
import { request } from '@/lib/api';
import {
  documentationAsset,
  findGuides,
  guideHeadings,
  guidePath,
  guides,
} from '@/lib/documentation';

export default function Documentation() {
  const { guide: slug } = useParams();
  const { hash, pathname } = useLocation();
  const [search, setSearch] = useState('');
  const guide = guides.find((item) => item.slug === slug);
  const matches = useMemo(() => findGuides(search), [search]);
  const query = useQuery({
    queryKey: ['documentation', guide?.file],
    enabled: Boolean(guide),
    queryFn: ({ signal }) =>
      request<{ content: string }>(
        documentationAsset(guide!.file).replace(/^\/api/, ''),
        { signal },
      ),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const content = query.data?.content;
  const headings = useMemo(
    () => guideHeadings(content ?? '').filter((heading) => heading.depth === 2),
    [content],
  );
  useEffect(() => {
    if (!content) return;
    let id = '';
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      /* Ignore malformed bookmark. */
    }
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [content, hash, pathname]);

  return (
    <Layout>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-slate-600" />
            <h1 className="text-xl font-semibold text-slate-900">
              Documentation
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            Understand your vault, work with credentials, and connect your
            tools.
          </p>
        </div>
        {guide && content && (
          <button
            type="button"
            onClick={() => window.print()}
            className="doc-print flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <Printer className="h-4 w-4" />
            Print guide
          </button>
        )}
      </header>
      <div className={guide ? 'documentation-layout' : ''}>
        <aside
          className={guide ? 'documentation-navigation' : 'mb-6 max-w-xl'}
          aria-label="Documentation navigation"
        >
          {slug && (
            <Link
              to="/documentation"
              className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              All documentation
            </Link>
          )}
          <label
            htmlFor="documentation-search"
            className="mb-2 block text-sm font-medium text-slate-700"
          >
            Search guides
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              id="documentation-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try Proton, MFA, or AI"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-hidden focus:border-slate-500"
            />
          </div>
          {guide && (
            <>
              <nav className="mt-5 space-y-1" aria-label="Guides">
                {matches.map((item) => (
                  <Link
                    key={item.slug}
                    to={guidePath(item.slug)}
                    aria-current={item.slug === slug ? 'page' : undefined}
                    className={`block rounded-lg px-3 py-2 text-sm ${item.slug === slug ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {item.title}
                  </Link>
                ))}
                {!matches.length && (
                  <p className="px-2 py-3 text-sm text-slate-500">
                    No guides match. Try a broader term.
                  </p>
                )}
              </nav>
              {!!headings.length && (
                <nav
                  className="mt-6 border-t border-slate-200 pt-4"
                  aria-label="On this page"
                >
                  <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    On this page
                  </h2>
                  {headings.map((heading) => (
                    <Link
                      key={heading.id}
                      className="block rounded-sm px-2 py-1.5 text-xs leading-5 text-slate-600 hover:bg-slate-100"
                      to={`${guidePath(guide.slug)}#${heading.id}`}
                    >
                      {heading.title}
                    </Link>
                  ))}
                </nav>
              )}
            </>
          )}
        </aside>
        {!slug ? (
          <div>
            {!search && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="mb-2 text-lg font-semibold text-slate-900">
                  Start with your first credential
                </h2>
                <p className="mb-4 max-w-2xl text-sm leading-6 text-slate-600">
                  Learn what Personal means, create a vault for a client, and
                  add the login you need. The guides include screenshots with
                  fictional data and explain which controls depend on your role.
                </p>
                <Link
                  to={guidePath('user-guide')}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Open the user guide
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
            {(['Start here', 'Reference', 'Operations'] as const).map(
              (group) => {
                const items = matches.filter((item) => item.group === group);
                return items.length ? (
                  <section key={group} className="mb-7">
                    <h2 className="mb-3 text-sm font-semibold text-slate-700">
                      {group}
                    </h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((item) => (
                        <Link
                          key={item.slug}
                          to={guidePath(item.slug)}
                          className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400"
                        >
                          <FileText className="mb-3 h-5 w-5 text-slate-500" />
                          <h3 className="mb-2 text-sm font-semibold text-slate-900">
                            {item.title}
                          </h3>
                          <p className="text-sm leading-6 text-slate-500">
                            {item.description}
                          </p>
                          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                            Read guide
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ) : null;
              },
            )}
            {!matches.length && (
              <p
                role="status"
                className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600"
              >
                No guides match “{search}”. Try Proton, passwords, invitations,
                or recovery.
              </p>
            )}
          </div>
        ) : !guide ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-2 text-lg font-semibold">Guide not found</h2>
            <p className="mb-4 text-sm text-slate-600">
              This documentation link may have changed.
            </p>
            <Link to="/documentation" className="text-sm font-medium underline">
              Browse all guides
            </Link>
          </section>
        ) : (
          <div className="min-w-0">
            {query.isPending ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading guide…
              </div>
            ) : query.isError ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-white p-6"
              >
                <h2 className="font-semibold text-slate-900">
                  This guide could not be loaded
                </h2>
                <p className="my-2 text-sm text-slate-600">
                  Check your connection and try again.
                </p>
                <button
                  type="button"
                  onClick={() => query.refetch()}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  Retry
                </button>
              </div>
            ) : (
              <GuideContent file={guide.file} content={content ?? ''} />
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
