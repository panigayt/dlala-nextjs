'use client';

// Server-visible view counting — mirrors js/listing.js:
//   - recordSignedInView(): a signed-in non-owner writes
//     listingViews/{listingId}_{uid}_{YYYYMMDD} with
//     {listingId, uid, date, createdAt} — the rules' validViewDoc (v119+)
//     requires the date as an 8-digit STRING. The doc id is deterministic
//     per day, so a repeat view the same day is a harmless overwrite — the
//     once-per-viewer-per-day semantics.
//   - recordAnonymousView() (0.0.0.1r, Zak): signed-out visitors count too.
//     The client mints a stable per-device id (anon_<32hex>, persisted in
//     localStorage as dlala_anon_id) and writes the SAME contract, so the
//     recordView Cloud Function and its 24h throttle apply unchanged.
//     Crawlers never reach this code (the prerender serves them
//     server-rendered HTML), but a bot-UA guard stays as defense in depth.
//   - Signed-in OWNERS are excluded (js/listing.js parity — viewing your
//     own ad must not inflate its view count).
// Local YYYYMMDD like the app (the ~23:00-00:00 edge is the accepted
// standing tradeoff). Best-effort: a denied/failed write is silently
// ignored and must never break the listing page.

import { useEffect } from 'react';
import { getFirebaseClient } from '@/lib/firebase-client';
import { } from '@/lib/firebase-compat';
import { withTimeout } from '@/lib/timeout';

function viewDateStr(): string {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
}

const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|baidu|yandex|sogou|exabot|facebot|ia_archiver|facebookexternalhit|whatsapp|telegram|pinterest|embedly/i;

function mintAnonId(): string | null {
  try {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) return null;
    let id: string | null = null;
    try {
      id = localStorage.getItem('dlala_anon_id');
    } catch {
      /* private mode etc. */
    }
    if (!/^anon_[0-9a-f]{32}$/.test(id || '')) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id =
        'anon_' +
        Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      try {
        localStorage.setItem('dlala_anon_id', id);
      } catch {
        /* private mode etc. */
      }
    }
    return id;
  } catch {
    return null;
  }
}

async function writeView(listingId: string, uid: string): Promise<void> {
  try {
    const client = await getFirebaseClient();
    const date = viewDateStr();
    const batch = client.db.batch();
    batch.set(client.db.doc(`listingViews/${listingId}_${uid}_${date}`), {
      listingId,
      uid,
      date,
      createdAt: client.FieldValue.serverTimestamp(),
    });
    await withTimeout(batch.commit(), 15000).catch(() => {
      /* best-effort: a failed write is silently ignored */
    });
  } catch {
    /* view counting must never break the listing page */
  }
}

export default function ViewRecorder({
  listingId,
  sellerId,
}: {
  listingId: string;
  sellerId: string;
}) {
  useEffect(() => {
    let done = false;
    let unsub: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (unsub) unsub();
    };
    getFirebaseClient()
      .then((client) => {
        if (done) return;
        // Firebase fires the first onAuthStateChanged callback with the
        // restored auth state, so one subscription settles signed-in vs
        // signed-out without risking an anonymous record for a signed-in
        // user whose auth was still restoring.
        unsub = client.auth.onAuthStateChanged((u) => {
          if (done) return;
          done = true;
          cleanup();
          if (u) {
            if (u.uid !== sellerId) void writeView(listingId, u.uid);
          } else {
            const ua =
              (typeof navigator !== 'undefined' && navigator.userAgent) || '';
            if (BOT_RE.test(ua)) return;
            const anon = mintAnonId();
            if (anon) void writeView(listingId, anon);
          }
        });
        // Safety net: auth always settles; if it somehow doesn't, record
        // nothing rather than a view under the wrong identity.
        timer = setTimeout(() => {
          if (!done) {
            done = true;
            cleanup();
          }
        }, 15000);
      })
      .catch(() => {
        /* SDK failed to load: no view recorded */
      });
    return () => {
      done = true;
      cleanup();
    };
    // Intentionally keyed on the id only: one view record per listing open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);
  return null;
}
