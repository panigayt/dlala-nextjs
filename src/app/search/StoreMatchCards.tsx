'use client';

// Verified-store cards atop search results — js/home.js 0.0.0.1m parity
// (Zak-ordered). Best-effort background fetch: the results paint first,
// store cards splice in when ready. Only for text queries (legacy skips
// when F.q is empty); mounted once above the grid so "عرض المزيد"
// appends never re-trigger it (legacy: "skipped on appends — the cards
// are already painted above page 1").

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WILAYAS } from '@/lib/wilayas';
import type { VerifiedStore } from '@/lib/firestore';

// Byte-exact vs js/i18n.{ar,fr,en}.js (matchingStore/matchingStoresPick/
// proMerchant/visitStore). The search page is AR-first today; FR/EN ride
// the future full-page i18n pass — the component already takes lang.
const STR = {
  ar: {
    matchingStore: 'متجر مطابق',
    matchingStoresPick: 'عدة متاجر مطابقة — اختر واحداً',
    proMerchant: 'تاجر محترف',
    visitStore: 'زيارة',
  },
  fr: {
    matchingStore: 'Boutique correspondante',
    matchingStoresPick: 'Plusieurs boutiques correspondent — choisissez-en une',
    proMerchant: 'Commerçant pro',
    visitStore: 'Visiter',
  },
  en: {
    matchingStore: 'Matching store',
    matchingStoresPick: 'Multiple matching stores — pick one',
    proMerchant: 'Pro merchant',
    visitStore: 'Visit',
  },
} as const;

type Lang = keyof typeof STR;

function wilayaName(code: number | undefined): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string }[]).find(
    (x) => x.code === Number(code)
  );
  return w ? `${w.code} - ${w.ar}` : '';
}

// js/home.js storeMatchCardHtml — verbatim structure and class names.
function StoreCard({
  s,
  eager,
  t,
}: {
  s: VerifiedStore;
  eager: boolean;
  t: (typeof STR)[Lang];
}) {
  const uid = s.uid || '';
  const name = s.storeName || s.username || '';
  const logo =
    s.storeLogoUrl && /^https:\/\//i.test(String(s.storeLogoUrl))
      ? String(s.storeLogoUrl)
      : '';
  const letter = (String(name).trim()[0] || '?').toUpperCase();
  // 0.0.0.31 FIX-WEB-007: the matches block sits above the results, so the
  // first logo is an LCP candidate — eager + high priority, not lazy.
  const meta = [wilayaName(s.storeWilaya), `👥 ${Number(s.followerCount) || 0}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="store-match-card">
      <Link className="smc-link" href={`/seller/${uid}`}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="smc-logo"
            src={logo}
            alt=""
            decoding="async"
            {...(eager
              ? { fetchPriority: 'high' as const }
              : { loading: 'lazy' as const })}
          />
        ) : (
          <div className="smc-logo smc-letter">{letter}</div>
        )}
        <span className="smc-body">
          <span className="smc-name">
            {name} <span className="pro-badge">★ {t.proMerchant}</span>
          </span>
          <span className="smc-meta">{meta}</span>
        </span>
        <span className="smc-go">{t.visitStore} ←</span>
      </Link>
    </div>
  );
}

export default function StoreMatchCards({
  q,
  lang = 'ar',
}: {
  q: string;
  lang?: Lang;
}) {
  const [stores, setStores] = useState<VerifiedStore[] | null>(null);

  useEffect(() => {
    const query = (q || '').trim();
    if (!query) return;
    let cancelled = false;
    fetch(`/api/search/store-matches?q=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setStores(Array.isArray(j?.stores) ? j.stores : []);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const t = STR[lang] ?? STR.ar;
  if (!stores || stores.length === 0) return null;
  // js/home.js insertStoreCards — verbatim: singular/plural label with 🏪.
  const label = stores.length === 1 ? t.matchingStore : t.matchingStoresPick;
  return (
    <div className="store-matches">
      <div className="smc-label">🏪 {label}</div>
      {stores.map((s, i) => (
        <StoreCard key={s.uid || `store-${i}`} s={s} eager={i === 0} t={t} />
      ))}
    </div>
  );
}
