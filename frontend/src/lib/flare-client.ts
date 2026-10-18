// Optional, dependency-free browser error reporting for the Flare dashboard.
//
// This deliberately stays small and disabled unless VITE_FLARE_DSN is set.
// A browser DSN is an ingest credential by design, so the server's per-DSN
// rate limit and project alert rules remain the control plane. Do not put a
// member API key or any other secret in this module.

export interface FlareBrowserCaptureOptions {
	dsn?: string;
	environment?: string;
	release?: string;
	maxEventsPerMinute?: number;
	captureResourceErrors?: boolean;
}

interface ParsedDsn {
	endpoint: string;
}

interface StackFrame {
	filename?: string;
	function?: string;
	lineno?: number;
	colno?: number;
	in_app?: boolean;
}

const maxFrames = 32;
const duplicateWindowMs = 10_000;
const defaultMaxEventsPerMinute = 20;

function buildLabel(value: unknown, fallback: string): string {
	return typeof value === 'string' && /^[A-Za-z0-9._@+-]{1,100}$/.test(value) ? value : fallback;
}

function safePage(): string | undefined {
	if (typeof location === 'undefined') return undefined;
	// No arbitrary path, hostname, query, fragment, vault title or identifier.
	const routes = new Set(['/', '/login', '/setup', '/invite', '/client-onboarding',
		'/vault', '/activity', '/credential-access', '/users', '/settings']);
	return routes.has(location.pathname) ? location.pathname : '/:unknown';
}

function parseDsn(raw: string): ParsedDsn | null {
	try {
		const url = new URL(raw.trim());
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
		if (!url.username || url.password) return null;
		const path = url.pathname.replace(/\/+$/, '');
		const slash = path.lastIndexOf('/');
		const projectID = path.slice(slash + 1);
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectID)) return null;
		const basePath = slash > 0 ? path.slice(0, slash) : '';
		const key = decodeURIComponent(url.username);
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return null;
		const endpoint = `${url.origin}${basePath}/api/${encodeURIComponent(projectID)}/events?sentry_key=${encodeURIComponent(key)}&sentry_version=7`;
		return { endpoint };
	} catch {
		return null;
	}
}

function eventID(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID().replace(/-/g, '');
	}
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}
	return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32).padEnd(32, '0');
}

function frameFilename(raw: string, trustedModuleURL: string): string | undefined {
	try {
		const url = new URL(raw, typeof location === 'undefined' ? undefined : location.href);
		const trusted = new URL(trustedModuleURL);
		// Filename provenance comes from this compiled module, not error.stack.
		// Unknown lazy chunks are omitted until a trusted build manifest exists.
		if (trusted.origin === location.origin && url.origin === trusted.origin && url.pathname === trusted.pathname &&
			/^\/assets\/[A-Za-z0-9_-]{1,160}\.js$/.test(trusted.pathname)) {
			return trusted.pathname;
		}
	} catch {
		// A malformed location never falls back to copying the raw value.
	}
	return undefined;
}

export function projectPrivateBrowserFrames(stack: string | undefined, trustedModuleURL: string): StackFrame[] {
	if (typeof stack !== 'string' || !stack) return [];
	const frames: StackFrame[] = [];
	for (const line of stack.slice(0, 32_768).split('\n').slice(0, maxFrames)) {
		const trimmed = line.trim();
		const match = trimmed.match(/(https?:\/\/[^\s()]+?):(\d+)(?::(\d+))?\)?$/);
		if (!match) continue;
		const [, file, lineNumber, columnNumber] = match;
		const filename = frameFilename(file ?? '', trustedModuleURL);
		if (!filename) continue;
		frames.push({
			filename,
			lineno: Number(lineNumber),
			colno: columnNumber ? Number(columnNumber) : undefined,
			in_app: true
		});
	}
	return frames;
}

function errorDetails(value: unknown): { type: string; stack?: string } {
	if (value instanceof Error) {
		const allowedTypes = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError',
			'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);
		return {
			type: allowedTypes.has(value.name) ? value.name : 'Error',
			stack: value.stack
		};
	}
	// Rejection values can be a whole CSV row, API response, File or credential.
	// Never stringify them or inspect their fields.
	return { type: 'UnhandledRejection' };
}

type CaptureCode = 'TRUSTISSUES_BROWSER_ERROR' | 'TRUSTISSUES_RENDER_ERROR' | 'TRUSTISSUES_RESOURCE_ERROR' | 'TRUSTISSUES_UNHANDLED_REJECTION';

function installSender(dsn: ParsedDsn, options: FlareBrowserCaptureOptions): (value: unknown, code: CaptureCode, stack?: string) => void {
	const maxEvents = Math.max(1, Math.min(options.maxEventsPerMinute ?? defaultMaxEventsPerMinute, 100));
	let windowStarted = Date.now();
	let sentInWindow = 0;
	const recent = new Map<string, number>();

	return (value, code, stack) => {
		const now = Date.now();
		if (now - windowStarted >= 60_000) {
			windowStarted = now;
			sentInWindow = 0;
			recent.clear();
		}
		if (sentInWindow >= maxEvents) return;
		const details = errorDetails(value);
		const frames = projectPrivateBrowserFrames(details.stack ?? stack, import.meta.url);
		const signature = JSON.stringify([code, details.type, safePage(), frames]);
		const previous = recent.get(signature);
		if (previous && now - previous < duplicateWindowMs) return;
		recent.set(signature, now);
		sentInWindow++;

		const payload = JSON.stringify({
			event_id: eventID(),
			platform: 'javascript',
			level: 'error',
			environment: buildLabel(options.environment, 'production'),
			release: buildLabel(options.release, ''),
			timestamp: now / 1000,
			message: code,
			fingerprint: ['trustissues-browser', code, details.type, safePage() ?? '/:unknown',
				...frames.slice(-28).map((frame) => `${frame.filename}:${frame.lineno}:${frame.colno ?? 0}`)],
			exception: {
				values: [{
					type: details.type,
					value: code,
					stacktrace: { frames }
				}]
			},
			request: safePage() ? { url: safePage() } : undefined,
			tags: { source: 'flare-browser-capture', error_code: code }
		});

		// Unlike sendBeacon, fetch can explicitly omit all cookies. No vault
		// request, DOM, input, user, breadcrumbs or arbitrary error text is read.
		try {
			if (typeof fetch !== 'function') return;
			void fetch(dsn.endpoint, {
				method: 'POST',
				body: payload,
				headers: { 'Content-Type': 'text/plain' },
				mode: 'no-cors',
				credentials: 'omit',
				referrerPolicy: 'no-referrer',
				keepalive: true
			}).catch(() => {
				// Reporting must never surface as an application error or recurse.
			});
		} catch {
			// A reporting failure must not break the vault or recurse.
		}
	};
}

interface FlareBoundaryEventDetail {
	error?: unknown;
	componentStack?: string;
}

/**
 * Install bounded browser error capture once.
 *
 * The bridge intentionally uses the Sentry envelope shape but no browser SDK:
 * this keeps first-party static frontends small and avoids putting an API key
 * in the bundle. The DSN is an ingest-only credential and is rate limited by
 * Flare. React error boundaries can report handled render failures by
 * dispatching `flare:exception` with `{ error, componentStack }`.
 */
export function installFlareBrowserCapture(options: FlareBrowserCaptureOptions): () => void {
	if (typeof window === 'undefined' || !options.dsn?.trim()) return () => {};
	const dsn = parseDsn(options.dsn);
	if (!dsn) return () => {};
	const marker = '__flareBrowserCaptureInstalled';
	if ((window as Window & { [marker]?: boolean })[marker]) return () => {};
	(window as Window & { [marker]?: boolean })[marker] = true;
	const send = installSender(dsn, options);
	const onError = (event: ErrorEvent) => {
		// Resource failures also arrive as ErrorEvents. The capture-phase listener
		// below records those with a sanitized origin/path; do not emit a second
		// generic "Unhandled browser error" for the same failure.
		if (event.target instanceof Element) return;
		send(event.error, 'TRUSTISSUES_BROWSER_ERROR');
	};
	const onRejection = (event: PromiseRejectionEvent) => send(event.reason, 'TRUSTISSUES_UNHANDLED_REJECTION');
	const onResourceError = (event: Event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		send(undefined, 'TRUSTISSUES_RESOURCE_ERROR');
	};
	const onBoundary = (event: Event) => {
		const detail = (event as CustomEvent<FlareBoundaryEventDetail>).detail;
		if (detail) send(detail.error, 'TRUSTISSUES_RENDER_ERROR', detail.componentStack);
	};
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	if (options.captureResourceErrors !== false) window.addEventListener('error', onResourceError, true);
	window.addEventListener('flare:exception', onBoundary);
	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
		if (options.captureResourceErrors !== false) window.removeEventListener('error', onResourceError, true);
		window.removeEventListener('flare:exception', onBoundary);
		delete (window as Window & { [marker]?: boolean })[marker];
	};
}
