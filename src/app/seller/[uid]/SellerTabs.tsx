'use client';

// Seller page tabs — mirrors js/seller.js initSellerTabs (16 Sep 2026):
// Boutique/Listings first and default (Zak 16 Sep 2026), Infos second.
// - pro store → '🏬 المتجر'
// - owner → '📋 إعلاناتي'
// - visitor → '📋 الإعلانات'
// - Infos → 'المعلومات'
// Only the panels below the profile card switch; nothing above the tabs
// changes on tab switch (0.0.0.4 parity).

import { useState, type ReactNode } from 'react';
import { useAuthState } from '@/lib/firebase-client';

export default function SellerTabs({
  uid,
  isPro,
  listings,
  infos,
  listingsCount,
}: {
  uid: string;
  isPro: boolean;
  listings: ReactNode;
  infos: ReactNode;
  listingsCount: number;
}) {
  const [tab, setTab] = useState<'listings' | 'infos'>('listings');
  const auth = useAuthState();
  const isOwner = auth.status === 'signed-in' && auth.user.uid === uid;
  const listingsLabel = isPro ? '🏬 المتجر' : isOwner ? '📋 إعلاناتي' : '📋 الإعلانات';

  const tabCls = (active: boolean) =>
    `flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${
      active ? 'bg-emerald-700 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-100'
    }`;

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="أقسام البائع" className="flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'listings'}
          onClick={() => setTab('listings')}
          className={tabCls(tab === 'listings')}
        >
          {listingsLabel} ({listingsCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'infos'}
          onClick={() => setTab('infos')}
          className={tabCls(tab === 'infos')}
        >
          المعلومات
        </button>
      </div>
      <div role="tabpanel" hidden={tab !== 'listings'} className="mt-4">
        {listings}
      </div>
      <div role="tabpanel" hidden={tab !== 'infos'} className="mt-4">
        {infos}
      </div>
    </div>
  );
}
