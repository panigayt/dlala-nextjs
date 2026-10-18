'use client';

// Wanted page shell — trilingual (js/wanted.js + js/i18n.js parity, Round 125).
//
// The wanted page is a Server Component (data fetch + URL-param filters);
// the heading, publish CTA, error/empty states and page dir must follow
// the UI language, so they live in this client shell (same pattern as the
// Round 107 HomePage / Round 109 SearchPage client shells).
//
// R54 (18 Oct 2026): the q text-search filter is language-dependent, so it
// runs HERE (client-side, viewer's language) instead of on the server —
// server-side filtering by cookie poisoned the edge cache (the edge cannot
// vary by cookie; verified live). The server passes the cat/wilaya-filtered
// window; this shell applies the q match in the reader's language and the
// 60-cap (js/wanted.js parity).

import { useMemo } from 'react';
import { useLang } from '@/lib/i18n';
import { normSearchText, type ListingCard } from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
import WantedFilterBar, { type WantedFilters } from './WantedFilterBar';

const WANTED_LIMIT = 60;

// js/wanted.js text-match — verbatim logic, client-side in the viewer's
// language (was server-side with the dlala_lang cookie before R54).
function matchesQuery(l: ListingCard, q: string, lang: string): boolean {
  const nq = normSearchText(q);
  if (!nq) return true;
  const titleText =
    typeof l.title === 'string'
      ? l.title
      : l.title && typeof l.title === 'object'
        ? (l.title as Record<string, string>)[lang] || l.title.ar || ''
        : '';
  const descText =
    typeof l.description === 'string'
      ? l.description
      : l.description && typeof l.description === 'object'
        ? (l.description as Record<string, string>)[lang] || l.description.ar || ''
        : '';
  return normSearchText(titleText + ' ' + descText).includes(nq);
}

// Visual skeleton — no text, so no language dependency (search-page parity).
// R54: client component so dir follows the UI language without a cookie
// read in SSR.
export function WantedSkeleton() {
  const { lang } = useLang();
  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-white shadow-sm overflow-hidden"
            >
              <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
              <div className="p-3">
                <div className="h-5 bg-zinc-200 rounded animate-pulse w-1/2" />
                <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function WantedShell({
  f,
  docs,
  error,
}: {
  f: WantedFilters;
  docs: ListingCard[];
  error: string | null;
}) {
  const { t, lang } = useLang();

  const visible = useMemo(
    () => docs.filter((l) => matchesQuery(l, f.q || '', lang)).slice(0, WANTED_LIMIT),
    [docs, f.q, lang]
  );

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-zinc-900">{t('wanted')}</h1>
          <a
            href="/publish?mode=wanted"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 transition-colors"
          >
            {t('wantedPublishCta')}
          </a>
        </div>

        <WantedFilterBar f={f} />

        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
            {t('errorGeneric')}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl bg-white p-10 text-center text-zinc-500">
            {(f.cat || f.wilaya || f.q) ? t('noResults') : t('noWanted')}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {visible.map((l) => (
              <ListingCardView key={l.id} l={l} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
