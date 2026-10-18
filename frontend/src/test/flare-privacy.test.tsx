import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { installFlareBrowserCapture, projectPrivateBrowserFrames } from '@/lib/flare-client';

const canary = 'PRIVATE_SYNTHETIC_CSV_VALUE_8931';
let stopCapture = () => {};

afterEach(() => {
  stopCapture();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function setupCapture() {
  const send = vi.fn().mockResolvedValue({});
  vi.stubGlobal('fetch', send);
  stopCapture = installFlareBrowserCapture({ dsn: 'https://public@flare.example/project', environment: 'production', release: 'abc1234' });
  return send;
}

function syntheticError() {
  const error = new TypeError(canary);
  error.stack = `TypeError: ${canary}\n    at unsafe ${canary} (${location.origin}/assets/index-test.js?password=${canary}:12:34)\n    at unsafe (${location.origin}/vault/${canary}:56:78)\n    at unsafe (https://${canary}.example/${canary}:1:2)`;
  return error;
}

function assertPrivateReport(send: ReturnType<typeof setupCapture>, code: string) {
  expect(send).toHaveBeenCalledTimes(1);
  const [endpoint, options] = send.mock.calls[0];
  expect(endpoint).toBe('https://flare.example/api/project/events?sentry_key=public&sentry_version=7');
  expect(options.credentials).toBe('omit');
  expect(options.referrerPolicy).toBe('no-referrer');
  const report = JSON.parse(options.body);
  expect(options.body).not.toContain(canary);
  expect(report.message).toBe(code);
  expect(report.exception.values[0].value).toBe(code);
  expect(report.release).toBe('abc1234');
  expect(report.request.url).toBe('/vault');
  return report;
}

describe('TrustIssues private browser capture', () => {
  it('captures a real React handled render failure without the error value or component text', () => {
    const send = setupCapture();
    window.history.replaceState({}, '', `/vault?password=${canary}#${canary}`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenImport(): never { throw syntheticError(); }
    render(<ErrorBoundary><BrokenImport /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    const report = assertPrivateReport(send, 'TRUSTISSUES_RENDER_ERROR');
    expect(report.exception.values[0].type).toBe('TypeError');
    // Vitest serves the module as a file URL, not a trusted compiled asset.
    expect(report.exception.values[0].stacktrace.frames).toEqual([]);
  });

  it('never serializes an arbitrary rejected object or unknown route', () => {
    const send = setupCapture();
    window.history.replaceState({}, '', `/vault/${canary}?${canary}`);
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: { password: canary, csv: canary, toJSON: () => { throw new Error('must not serialize'); } } });
    window.dispatchEvent(event);
    const report = JSON.parse(send.mock.calls[0][1].body);
    expect(send.mock.calls[0][1].body).not.toContain(canary);
    expect(report.message).toBe('TRUSTISSUES_UNHANDLED_REJECTION');
    expect(report.request.url).toBe('/:unknown');
    expect(report.exception.values[0].stacktrace.frames).toEqual([]);
  });

  it('captures a resource failure without reading the resource URL', () => {
    const send = setupCapture();
    window.history.replaceState({}, '', '/vault');
    const image = document.createElement('img');
    image.src = `https://${canary}.example/${canary}`;
    document.body.appendChild(image);
    try { image.dispatchEvent(new Event('error')); } finally { image.remove(); }
    assertPrivateReport(send, 'TRUSTISSUES_RESOURCE_ERROR');
  });

  it('deduplicates by safe code location even when secret-bearing messages differ', () => {
    const send = setupCapture();
    window.dispatchEvent(new ErrorEvent('error', { error: syntheticError() }));
    window.dispatchEvent(new ErrorEvent('error', { error: Object.assign(syntheticError(), { message: 'different-private-value' }) }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps only the compiled module location and never arbitrary same-origin asset names', () => {
    const trusted = `${location.origin}/assets/index-test.js`;
    const frames = projectPrivateBrowserFrames(syntheticError().stack, trusted);
    expect(frames).toEqual([{ filename: '/assets/index-test.js', lineno: 12, colno: 34, in_app: true }]);
    const spoof = `at arbitrary (${location.origin}/assets/${canary}.js:10:20)`;
    expect(projectPrivateBrowserFrames(spoof, trusted)).toEqual([]);
    expect(projectPrivateBrowserFrames(spoof, trusted).toString()).not.toContain(canary);
  });

  it('refuses plaintext remote DSNs before installing any reporting listener', () => {
    const send = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', send);
    stopCapture = installFlareBrowserCapture({ dsn: 'http://public@flare.example/project' });
    window.dispatchEvent(new CustomEvent('flare:exception', { detail: { error: syntheticError() } }));
    expect(send).not.toHaveBeenCalled();
  });
});
