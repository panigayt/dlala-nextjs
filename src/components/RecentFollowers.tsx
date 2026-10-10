// Recent followers box — owner-only.
// Port of js/seller.js loadRecentFollowers (v101 follow-notif, Zak,
// 16 Sep 2026): the owner sees their latest followers (avatar + name,
// each linking to the follower's profile) on their own page. Visitors
// never see this section.
//
// Placement (legacy verbatim):
// - pro owner: in the Infos tab (renderSellerExtras 0.0.0.4)
// - ordinary owner: below the profile card (sellerBox render)
// Both placements use this same component; the parent chooses where.
// Empty follower list → renders nothing (legacy: box.style.display='none').

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthState } from '@/lib/firebase-client';
import { useLang, type Lang } from '@/lib/i18n';
import { withTimeout } from '@/lib/firebase-compat';
import { RECENT_FOLLOWERS_N } from '@/lib/store-owner';

const STRINGS: Record<Lang, Record<string, string>> = {
  ar: { recentFollowers: 'أحدث المتابِعين', loading: 'جارٍ التحميل...' },
  fr: { recentFollowers: 'Derniers abonnés', loading: 'Chargement...' },
  en: { recentFollowers: 'Recent followers', loading: 'Loading...' },
};

interface FollowerProfile {
  uid: string;
  name: string;
  username: string;
  avatarUrl: string;
}

function FollowerAvatar({ p }: { p: FollowerProfile }) {
  if (p.avatarUrl && /^https:\/\//i.test(p.avatarUrl)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" src={p.avatarUrl} alt="" />;
  }
  const ch = (p.name || p.username || '?')[0] || '?';
  return <div className="avatar">{ch}</div>;
}

export default function RecentFollowers({ uid }: { uid: string }) {
  const auth = useAuthState();
  const { lang } = useLang();
  const STR = STRINGS[lang] || STRINGS.ar;
  const [profiles, setProfiles] = useState<FollowerProfile[] | null>(null);
  const mounted = useRef(true);

  const signedIn = auth.status === 'signed-in';
  const user = signedIn ? auth.user : null;
  const client = signedIn ? auth.client : null;
  const isOwner = !!(user && user.uid === uid);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOwner || !user || !client) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await withTimeout(
          client.db
            .collection('follows')
            .where('storeId', '==', uid)
            .orderBy('createdAt', 'desc')
            .limit(RECENT_FOLLOWERS_N)
            .get(),
          15000
        );
        if (snap.docs.length === 0) {
          if (!cancelled && mounted.current) setProfiles([]);
          return;
        }
        // 0.0.0.31 (users_public split): follower profiles are public reads.
        const list = await Promise.all(
          snap.docs.map(async (d) => {
            const fid = String(
              ((d.data() || {}) as Record<string, unknown>).followerId || ''
            );
            try {
              const p = await withTimeout(
                client.db.doc(`users_public/${fid}`).get(),
                10000
              );
              const data = (p.exists ? p.data() || {} : {}) as Record<
                string,
                unknown
              >;
              return {
                uid: fid,
                name: typeof data.name === 'string' ? data.name : '',
                username:
                  typeof data.username === 'string' ? data.username : '',
                avatarUrl:
                  typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
              };
            } catch {
              return { uid: fid, name: '', username: '', avatarUrl: '' };
            }
          })
        );
        if (!cancelled && mounted.current) setProfiles(list);
      } catch {
        // Best-effort: never break the profile (legacy hides the box).
        if (!cancelled && mounted.current) setProfiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, user, client, uid]);

  if (auth.status === 'loading') return null;
  if (!isOwner) return null;
  if (profiles === null)
    return (
      <div className="acc-section" style={{ marginTop: 16 }}>
        <div className="spinner">{STR.loading}</div>
      </div>
    );
  if (profiles.length === 0) return null;

  return (
    <div className="acc-section" style={{ marginTop: 16 }}>
      <h3 className="section-title">{STR.recentFollowers}</h3>
      <div className="recent-followers">
        {profiles.map((p) => (
          <Link
            key={p.uid}
            className="rf-row"
            href={`/seller/${encodeURIComponent(p.uid)}`}
          >
            <FollowerAvatar p={p} />
            <span className="rf-name">
              {p.name}
              {p.username ? <span className="uname">@{p.username}</span> : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
