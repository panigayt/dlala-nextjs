// Announcements list — client shell.
//
// Round 120: the server page fetches the data; everything the user READS
// (heading, empty/error/loading states, dir) comes from the app-wide
// language store (useLang), so the header switch re-renders this page.
// Replaces the stacked AR/FR/EN hardcoded blocks.

'use client';

import { useLang } from '@/lib/i18n';
import AnnList, { type AnnListItem } from './AnnList';

export function AnnSkeleton() {
  const { t } = useLang();
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl bg-white p-4 shadow-sm">
          <div className="h-5 w-2/3 animate-pulse rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-1/4 animate-pulse rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-full animate-pulse rounded bg-zinc-200" />
        </div>
      ))}
      <p className="sr-only">{t('loading')}</p>
    </div>
  );
}

export default function AnnouncementsClient({
  items,
  error,
}: {
  items: AnnListItem[];
  error: boolean;
}) {
  const { t, lang } = useLang();

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-4 text-xl font-bold text-zinc-900">{t('announcements')}</h1>
        {error ? (
          <div className="rounded-xl bg-white p-8 text-center text-zinc-600">
            <p>{t('errorGeneric')}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              {t('retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center">
            <div className="text-4xl">📢</div>
            <p className="mt-3 text-zinc-600">{t('noAnnouncements')}</p>
          </div>
        ) : (
          <AnnList items={items} />
        )}
      </main>
    </div>
  );
}
