# Private diagnostics for TrustIssues

Flare receives diagnostic metadata from this vault product. It does not receive
vault entries, imported CSV rows, passwords, notes, TOTP seeds, form values,
request bodies, cookies, authorization headers, user profiles or session replay.
This boundary uses an allowlist; arbitrary error text is omitted rather than
being treated as safe after regex redaction.

## Browser reports

The optional reporter is enabled only by a public, ingest-only build DSN.
Production Compose passes the DSN and environment into Vite and uses the same
`SERVER_VERSION` as the backend for its release. Remote DSNs require HTTPS;
HTTP is allowed only for local loopback development.

Reports contain an event ID/time, build release/environment, a fixed diagnostic
code, an allowlisted JavaScript exception type, and a known page route such as
`/vault`. Unknown paths become `/:unknown`; query strings, fragments and hostnames
are excluded. Rejected objects and strings are never serialized. Resource error
reports do not read resource URLs. The React ErrorBoundary explicitly signals
handled render failures to this same private reporter.

Stack locations must match the reporter's actual compiled `import.meta.url`.
Only the trusted asset path and numeric line/column are kept; function strings,
absolute URLs, source context and variables are omitted. Unknown lazy chunks are
dropped until there is a trusted build manifest. This deliberately limits stack
detail. Fingerprints and duplicate suppression use the safe code/location,
never the original error value. Capture is bounded to 32 stack frames and a
per-minute event limit.

Delivery uses keepalive fetch with `credentials: omit` and
`referrerPolicy: no-referrer`. Neither vault cookies nor an implicit Referer URL
are attached. The CSP permits only the two configured house Flare origins in
addition to the application's own origin.

## Backend reports

Both Sentry error and transaction hooks construct a fresh event. Retained fields
are a fixed server-error category, trusted service/release identity, an
allowlisted environment, event ID/time, HTTP method and a product route template.
All request headers, bodies, hostnames, raw paths, exception values, user data,
breadcrumbs, custom contexts/tags, attachments and source/variable context are
excluded. Transactions are not enabled by this change.

First-party stack metadata comes from `runtime.Callers` during the synchronous
capture hook, so module/function/file locations come from the running compiler
image rather than prefilled exception strings. An earlier creation stack stored
inside a handled error is omitted if it differs from the active capture chain.
The original panic is still rethrown for the existing HTTP recovery behavior;
`http.ErrAbortHandler` remains an unreported control action.

Panics and handled failures routed through `writeInternalError` are reported.
Expected 4xx responses are excluded. Other independently implemented error
responses and raw server logs are not automatically covered. The fixed
`service-up:trustissues` info heartbeat retains its existing liveness semantics;
a heartbeat does not prove frontend capture or complete error coverage.

## Import and portability boundary

The existing Proton Pass CSV flow converts the file in the browser into the
native TrustIssues JSON format before preview and confirmation. It preserves
source cells and vault grouping using that native flow, including secret custom
fields. PGP and Proton Pass ZIP preparation also run in the browser. See
[`PGP-IMPORT-EXPORT.md`](PGP-IMPORT-EXPORT.md) for the supported portability
formats and their limits. This diagnostics change does not replace those flows
or introduce a server-side Proton CSV mapper.

CSV rows, decoded JSON, passwords, notes, TOTP values, passphrases, PGP key
material, source metadata and collection names are excluded from diagnostic
payloads. Import failures receive the same fixed error codes and known route
templates as other failures. Expected validation failures remain local to the
import UI and are not server-error events. Browser-side decryption does not
mean an authenticated native import is offline: the prepared file is uploaded
to TrustIssues under the existing vault authorization and encryption boundary.

## Verification and rollout

Synthetic tests exercise the real React ErrorBoundary, SDK transport after scope
and hint processing, panic application frames, handled 500 responses and
heartbeat semantics. Existing Proton CSV/native import regressions separately
verify the preserved browser conversion and preview/confirmation flow. Canary
values are absent from outbound diagnostic payloads. No real vault data, user
CSV or login credentials are used by these tests.

Source tests and a local build do not establish production capture. Managed
exact CI, source/image admission, the existing vault backup/migration/recovery
checks, and a controlled synthetic browser receipt are separate release gates.
