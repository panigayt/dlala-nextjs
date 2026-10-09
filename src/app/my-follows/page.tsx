// My Follows page — all users the viewer follows.
//
// Migrated from my-follows.html + js/my-follows.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Reads follows where followerId == uid (limit 200, client-side sort)
// - Hydrates each followed user from users_public/{uid}
// - Verified stores show the gold pro-merchant badge
// - Name, @username, follower count, rating shown per row
// - Unfollow button with optimistic UI (row removed on confirm)
// - "جديد" (new) badge for follows with unseen listings from last 7 days
//   (per-user seen watermark in localStorage, stamped on profile open)
// - Empty state with browse CTA

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate, { PageHeader } from '@/components/AuthGate';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { useLang } from '@/lib/i18n';

const FOLLOW_SEEN_KEY = 'dlala_followseen_v1';
const FOLLOWS_NEW_MS = 7 * 86400000;

interface FollowRow {
  storeId: string;
  createdAt?: unknown;
}

interface FollowedUser {
  storeName?: string;
  name?: string;
  username?: string;
  followerCount?: number;
  rating?: number;
  ratingCount?: number;
  storeTier?: string;
}

function followSeenLoad(): Record<string, number> {
  try {
    const o = JSON.parse(localStorage.getItem(FOLLOW_SEEN_KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function followSeenSave(seen: Record<string, number>) {
  try {
    localStorage.setItem(FOLLOW_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}

// Pure helper (mirrors js/my-follows.js followHasNew): does this follow
// deserve the "new" badge?
function followHasNew(seenMs: number | undefined, newestMs: number | undefined, nowMs: number): boolean {
  if (!newestMs) return false;
  if (nowMs - newestMs > FOLLOWS_NEW_MS) return false;
  return newestMs > (seenMs || 0);
}

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const o = v as { toDate?: () => Date; seconds?: number };
  if (typeof o.toDate === 'function') {
    try {
      return o.toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return 0;
}

type DbLike = {
  collection: (p: string) => {
    where: (f: string, op: string, v: string) => {
      limit: (n: number) => { get: () => Promise<{ docs: { data: () => Record<string, unknown> }[] }> };
    };
  };
  doc: (p: string) => {
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
    delete: () => Promise<void>;
  };
};

export default function MyFollowsPage() {
  return (
    <AuthGate>
      {(user) => <MyFollowsContent user={user} />}
    </AuthGate>
  );
}

function MyFollowsContent({ user }: { user: CompatUser }) {
  const { lang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [rows, setRows] = useState<{ row: FollowRow; user: FollowedUser }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newBadges, setNewBadges] = useState<Record<string, boolean>>({});
  const [unfollowing, setUnfollowing] = useState<string | null>(null);
  const mounted = useRef(true);

  // Best-effort: find each followed user's newest recent listing for the
  // "جديد" badge (chunked sellerId-in queries, first 120 follows max).
  const paintNewBadges = useCallback(
    async (db: DbLike, uids: string[]) => {
      try {
        if (!uids.length) return;
        const now = Date.now();
        const newest: Record<string, number> = {};
        const chunks: string[][] = [];
        for (let i = 0; i < Math.min(uids.length, 120); i += 30) chunks.push(uids.slice(i, i + 30));
        await Promise.all(
          chunks.map(async (chunk) => {
            try {
              const col = (db.collection('listings') as unknown as {
                where: (f: string, op: string, v: string[]) => {
                  limit: (n: number) => { get: () => Promise<{ docs: { data: () => Record<string, unknown> }[] }> };
                };
              })
                .where('sellerId', 'in', chunk)
                .limit(60);
              const snap = await withTimeout(col.get(), 15000);
              for (const d of snap.docs) {
                const data = d.data() || {};
                const st = String(data.status || '');
                if (st !== 'available' && st !== 'negotiating') continue;
                const ms = toMs(data.createdAt);
                if (!ms || now - ms > FOLLOWS_NEW_MS) continue;
                const sid = String(data.sellerId || '');
                if (sid && (!newest[sid] || ms > newest[sid])) newest[sid] = ms;
              }
            } catch {
              // one chunk failing must not kill the page
            }
          })
        );
        if (!mounted.current) return;
        const seen = followSeenLoad();
        const badges: Record<string, boolean> = {};
        for (const uid of uids) {
          if (followHasNew(seen[uid], newest[uid], now)) badges[uid] = true;
        }
        setNewBadges(badges);
      } catch {
        // best-effort
      }
    },
    []
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike;
      const snap = await withTimeout(
        db.collection('follows').where('followerId', '==', user.uid).limit(200).get(),
        20000
      );
      const followRows: FollowRow[] = [];
      for (const d of snap.docs) {
        const data = d.data() || {};
        if (data.storeId) followRows.push({ storeId: String(data.storeId), createdAt: data.createdAt });
      }
      if (!mounted.current) return;
      if (!followRows.length) {
        setRows([]);
        return;
      }
      // Client-side sort (no composite index dependency) — newest first.
      followRows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
      // Hydrate public profiles.
      const users: Record<string, FollowedUser> = {};
      await Promise.all(
        followRows.map(async (r) => {
          try {
            const ds = await withTimeout(db.doc('users_public/' + r.storeId).get(), 15000);
            if (ds.exists) users[r.storeId] = ds.data() as FollowedUser;
          } catch {
            // ignore
          }
        })
      );
      if (!mounted.current) return;
      setRows(followRows.map((row) => ({ row, user: users[row.storeId] || {} })));
      paintNewBadges(db, followRows.map((r) => r.storeId));
    } catch (e) {
      if (!mounted.current) return;
      console.error(e);
      setError(t('errorGeneric'));
    }
  }, [user.uid, t, paintNewBadges]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount, guarded by mounted ref */
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const markSeen = useCallback((uid: string) => {
    try {
      const seen = followSeenLoad();
      seen[uid] = Date.now();
      followSeenSave(seen);
    } catch {
      // ignore
    }
  }, []);

  const unfollow = useCallback(
    async (storeId: string) => {
      setUnfollowing(storeId);
      try {
        const fb = await getFirebase();
        type UnfollowDb = {
          collection: (p: string) => {
            where: (f: string, op: string, v: string) => {
              where: (f: string, op: string, v: string) => {
                limit: (n: number) => {
                  get: () => Promise<{ docs: { ref: { delete: () => Promise<void> } }[] }>;
                };
              };
            };
          };
        };
        const db = fb.firestore() as unknown as UnfollowDb;
        // Find the follow doc(s) and delete them.
        const snap = await withTimeout(
          db
            .collection('follows')
            .where('followerId', '==', user.uid)
            .where('storeId', '==', storeId)
            .limit(5)
            .get(),
          15000
        );
        await Promise.all(snap.docs.map((d) => withTimeout(d.ref.delete(), 15000)));
        // Drop the seen-watermark too: a later re-follow must be able to
        // earn its "جديد" badge again.
        try {
          const seen = followSeenLoad();
          delete seen[storeId];
          followSeenSave(seen);
        } catch {
          // ignore
        }
        if (mounted.current) {
          setRows((prev) => (prev ? prev.filter((r) => r.row.storeId !== storeId) : prev));
        }
      } catch (e) {
        console.error(e);
        if (mounted.current) window.alert(t('errorGeneric'));
      } finally {
        if (mounted.current) setUnfollowing(null);
      }
    },
    [user.uid, t]
  );

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>
      <PageHeader title={t('myFollows')} />

      <main className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-4">{t('myFollows')}</h1>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center">
            <p className="text-red-700 mb-4">⚠️ {error}</p>
            <button
              onClick={load}
              className="rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('retry')}
            </button>
          </div>
        )}

        {!error && rows === null && (
          <div className="text-center py-10">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
            <p className="mt-3 text-zinc-600">{t('loading')}</p>
          </div>
        )}

        {!error && rows !== null && rows.length === 0 && (
          <div className="rounded-xl bg-white shadow-sm p-10 text-center">
            <p className="text-5xl mb-4">👥</p>
            <p className="text-zinc-900 font-medium mb-1">{t('noFollows')}</p>
            <p className="text-zinc-500 text-sm mb-5">{t('noFollowsHint')}</p>
            <Link
              href="/"
              className="inline-block rounded-lg bg-emerald-700 px-6 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              {t('browseStores')}
            </Link>
          </div>
        )}

        {!error && rows !== null && rows.length > 0 && (
          <div className="rounded-xl bg-white shadow-sm divide-y divide-zinc-100">
            {rows.map(({ row, user: u }) => {
              const isPro = u.storeTier === 'verified';
              const name = u.storeName || u.name || '?';
              const uname = u.username ? '@' + u.username : '';
              const fCount = Number(u.followerCount) || 0;
              const rNum = Number(u.rating);
              const rTxt = u.ratingCount
                ? `${isFinite(rNum) ? rNum.toFixed(1) : '—'} ★ (${Number(u.ratingCount) || 0})`
                : '';
              const sub = [uname, `👥 ${fCount} ${t('followers')}`, rTxt].filter(Boolean).join(' · ');
              const busy = unfollowing === row.storeId;
              return (
                <div key={row.storeId} className="flex items-center gap-3 p-4">
                  <a
                    href={`/seller/${encodeURIComponent(row.storeId)}`}
                    onClick={() => markSeen(row.storeId)}
                    className="flex-1 min-w-0"
                  >
                    <div className="font-medium text-zinc-900 truncate">
                      {name}
                      {isPro && (
                        <span className="ms-2 inline-block rounded bg-amber-100 text-amber-800 text-xs px-2 py-0.5 font-bold">
                          ★ {t('proMerchant')}
                        </span>
                      )}
                      {newBadges[row.storeId] && (
                        <span className="ms-2 inline-block rounded bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 font-bold">
                          {t('newBadge')}
                        </span>
                      )}
                    </div>
                    {sub && <div className="text-xs text-zinc-500 truncate mt-0.5" dir="ltr">{sub}</div>}
                  </a>
                  <button
                    onClick={() => unfollow(row.storeId)}
                    disabled={busy}
                    aria-pressed="true"
                    className="shrink-0 rounded-lg bg-white border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    ✓ {t('following')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
