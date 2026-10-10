'use client';

// Verified-store cards atop search results — js/home.js 0.0.0.1m parity
// (Zak-ordered). Best-effort background fetch: the results paint first,
// store cards splice in when ready. Only for text queries (legacy skips
// when F.q is empty); mounted once above the grid so "عرض المزيد"
// appends never re-trigger it (legacy: "skipped on appends — the cards
// are already painted above page 1").
//
// Round 123: wired to the app-wide language store (js/i18n.js setLang
// parity) — the local STR copy is gone; matchingStore/matchingStoresPick/
// visitStore now live in src/lib/i18n.ts (verbatim js/i18n.{ar,fr,en}.js),
// and wilayaName uses the 0.0.0.21 I-08 formula (ar / en-with-fr-fallback / fr).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WILAYAS } from '@/lib/wilayas';
import { useLang, type Lang } from '@/lib/i18n';
import type { VerifiedStore } from '@/lib/firestore';

// 0.0.0.21 (I-08): English UI uses the English transliterations.
// Verbatim js/app.js wilayaName, LANG → lang.
function wilayaName(code: number | undefined, lang: Lang): string {
  if (!code) return '';
  const w = (WILAYAS as { code: number; ar: string; fr: string; en: string }[]).find(
    (x) => x.code === Number(code)
  );
  if (!w) return '';
  return lang === 'ar'
    ? `${w.code} - ${w.ar}`
    : lang === 'en' && w.en
      ? `${w.code} - ${w.en}`
      : `${w.code} - ${w.fr}`;
}

// js/home.js storeMatchCardHtml — verbatim structure and class names.
function StoreCard({ s, eager }: { s: VerifiedStore; eager: boolean }) {
  const { t, lang } = useLang();
  const uid = s.uid || '';
  const name = s.storeName || s.username || '';
  const logo =
    s.storeLogoUrl && /^https:\/\//i.test(String(s.storeLogoUrl))
      ? String(s.storeLogoUrl)
      : '';
  const letter = (String(name).trim()[0] || '?').toUpperCase();
  // 0.0.0.31 FIX-WEB-007: the matches block sits above the results, so the
  // first logo is an LCP candidate — eager + high priority, not lazy.
  const meta = [wilayaName(s.storeWilaya, lang), `👥 ${Number(s.followerCount) || 0}`]
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
            {name} <span className="pro-badge">★ {t('proMerchant')}</span>
          </span>
          <span className="smc-meta">{meta}</span>
        </span>
        <span className="smc-go">{t('visitStore')} ←</span>
      </Link>
    </div>
  );
}

export default function StoreMatchCards({ q }: { q: string }) {
  const { t } = useLang();
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

  if (!stores || stores.length === 0) return null;
  // js/home.js insertStoreCards — verbatim: singular/plural label with 🏪.
  const label = stores.length === 1 ? t('matchingStore') : t('matchingStoresPick');
  return (
    <div className="store-matches">
      <div className="smc-label">🏪 {label}</div>
      {stores.map((s, i) => (
        <StoreCard key={s.uid || `store-${i}`} s={s} eager={i === 0} />
      ))}
    </div>
  );
}
