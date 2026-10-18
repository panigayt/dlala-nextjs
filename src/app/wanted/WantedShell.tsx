'use client';

// Wanted page shell — trilingual (js/wanted.js + js/i18n.js parity, Round 125).
//
// The wanted page is a Server Component (data fetch + URL-param filters);
// the heading, publish CTA, error/empty states and page dir must follow
// the UI language, so they live in this client shell (same pattern as the
// Round 107 HomePage / Round 109 SearchPage client shells).

import { useLang } from '@/lib/i18n';
import type { ListingCard } from '@/lib/firestore';
import ListingCardView from '@/components/ListingCardView';
import WantedFilterBar, { type WantedFilters } from './WantedFilterBar';

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
        ) : docs.length === 0 ? (
          <div className="rounded-xl bg-white p-10 text-center text-zinc-500">
            {(f.cat || f.wilaya || f.q) ? t('noResults') : t('noWanted')}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {docs.map((l) => (
              <ListingCardView key={l.id} l={l} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
