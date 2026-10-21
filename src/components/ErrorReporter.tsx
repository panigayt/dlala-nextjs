'use client';

// Client error reporter — restored 21 Oct 2026 (Zak approved).
// The pre-migration site shipped js/error-report.js wired to the
// /report-error Cloud Function (europe-west3, still live); the 14 Oct
// Next.js/www cutover dropped both the Hosting rewrites and the client
// script, so real-user JS errors went uncollected for a week.
// This component restores collection with the same contract and guards:
//   - POST /report-error {message, stack, url, userAgent, appVersion, kind}
//     (Vercel rewrite proxies to the reportError function)
//   - max 5 reports per session, 60s dedupe on identical messages
//   - fire-and-forget: sendBeacon, fetch(keepalive) fallback, never throws
// - No imports beyond react: the lazy Firebase boundary stays intact and
//   this adds ~1KB to the shared client bundle, zero critical-path cost
//   (handlers install in useEffect, after hydration).

import { useEffect } from 'react';

const MAX_PER_SESSION = 5;
const DEDUPE_MS = 60_000;
const COUNT_KEY = 'dlala_err_count';

export default function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    try {
      sent = Number(sessionStorage.getItem(COUNT_KEY) || 0) || 0;
    } catch {
      sent = 0;
    }
    const lastByMsg = new Map<string, number>();

    const send = (message: string, stack: string, kind: string) => {
      try {
        if (!message || sent >= MAX_PER_SESSION) return;
        const now = Date.now();
        const last = lastByMsg.get(message) || 0;
        if (now - last < DEDUPE_MS) return;
        lastByMsg.set(message, now);
        sent += 1;
        try {
          sessionStorage.setItem(COUNT_KEY, String(sent));
        } catch {
          // Private mode etc. — the in-memory counter still applies.
        }
        const build =
          document
            .querySelector('meta[name="dlala-build"]')
            ?.getAttribute('content') || '';
        const body = JSON.stringify({
          message: message.slice(0, 500),
          stack: stack.slice(0, 2000),
          url: window.location.href.slice(0, 500),
          userAgent: navigator.userAgent.slice(0, 300),
          appVersion: build.slice(0, 20),
          kind,
        });
        if (typeof navigator.sendBeacon === 'function') {
          const ok = navigator.sendBeacon(
            '/report-error',
            new Blob([body], { type: 'application/json' }),
          );
          if (ok) return;
        }
        void fetch('/report-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Telemetry must never break the page.
      }
    };

    const onError = (e: ErrorEvent) => {
      const msg = e.message || (e.error ? String(e.error) : '');
      const stack =
        e.error && e.error.stack ? String(e.error.stack) : '';
      send(msg, stack, 'error');
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      const msg =
        r instanceof Error ? r.message : typeof r === 'string' ? r : 'unhandledrejection';
      const stack = r instanceof Error && r.stack ? r.stack : '';
      send(msg, stack, 'unhandledrejection');
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
