'use client';

// Card trust/ownership markers — js/app.js markOwnCards (HOM-4) + markProCards
// (16 Sep 2026) parity, rendered declaratively.
//
// Legacy paints the feed before auth resolves, then patches:
//   markOwnCards():   <span class="badge badge-own">✓ إعلانك</span> appended to
//                     a.card when data-sid == viewer uid (idempotent; guests: 0).
//   markProCards():   <span class="pro-badge">★ تاجر محترف</span> appended inside
//                     .card-title for verified pro merchants (font-size:11px,
//                     margin-inline-start:6px on top of the .pro-badge base).
//
// Here the same end-state is React state: the own badge appears the moment
// auth resolves (no DOM patching), and the pro badge resolves through the
// module-level verdict cache in @/lib/card-markers (one batched :batchGet
// per tick, no Firestore SDK download).

import { useEffect, useState } from 'react';
import { useAuthState } from '@/lib/firebase-client';
import { useLang } from '@/lib/i18n';
import {
  ensureProVerdicts,
  getProVerdict,
  subscribeProVerdicts,
} from '@/lib/card-markers';

export function useProVerdict(sellerId: string): boolean | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!sellerId) return;
    const unsub = subscribeProVerdicts(() => bump((x) => x + 1));
    ensureProVerdicts([sellerId]);
    return unsub;
  }, [sellerId]);
  return getProVerdict(sellerId);
}

// HOM-4 parity: "yours" marker on the viewer's own cards. The feed paints
// before auth (SSR/loading → null), then tags once auth is known — the same
// visual sequence as legacy's markOwnCards(). No-op for guests.
export function OwnBadge({ sellerId }: { sellerId: string }) {
  const { t } = useLang();
  const auth = useAuthState();
  const isMine =
    !!sellerId &&
    auth.status === 'signed-in' &&
    !!auth.user &&
    auth.user.uid === sellerId;
  if (!isMine) return null;
  return <span className="badge badge-own">✓ {t('yourListing')}</span>;
}

// 16 Sep 2026 parity: gold pro badge inside the card title for verified pro
// merchants. Renders only once the verdict resolves true (fails closed).
export function ProBadge({ sellerId }: { sellerId: string }) {
  const { t } = useLang();
  const verdict = useProVerdict(sellerId);
  if (verdict !== true) return null;
  return (
    <span className="pro-badge" style={{ fontSize: 11, marginInlineStart: 6 }}>
      ★ {t('proMerchant')}
    </span>
  );
}
