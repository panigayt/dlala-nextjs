// Client component: announcement cards + local search.
//
// Mirrors ~/workspace/dlala-040/js/announcements.js behavior:
//   - Cards are clickable and open the full article at /announcement/[id].
//   - The search input filters the already-fetched list locally.
//   - Card shows localized title, date, 160-char excerpt, "read more".
//
// Props are pre-localized plain strings (server → client must be
// serializable, so Dates are ISO strings).

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface AnnListItem {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  date: string; // locale-formatted date string (server-rendered)
  iso: string; // ISO date for the <time> element
}

// Trilingual UI strings — verbatim from js/i18n.{ar,en,fr}.js
const STR = {
  searchPh: { ar: 'ابحث في الإعلانات...', fr: 'Rechercher dans les annonces...', en: 'Search announcements...' },
  readMore: { ar: 'اقرأ المزيد', fr: 'Lire la suite', en: 'Read more' },
  empty: { ar: 'لا توجد إعلانات مطابقة لبحثك.', fr: 'Aucune annonce ne correspond à votre recherche.', en: 'No announcements match your search.' },
  searchLabel: { ar: 'ابحث في الإعلانات', fr: 'Rechercher dans les annonces', en: 'Search announcements' },
};

export default function AnnList({ items }: { items: AnnListItem[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(t));
  }, [q, items]);

  return (
    <div>
      <div className="mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={STR.searchPh.ar}
          aria-label={STR.searchLabel.ar}
          autoComplete="off"
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400"
        />
        <p lang="fr" dir="ltr" className="sr-only">
          {STR.searchLabel.fr}
        </p>
        <p lang="en" dir="ltr" className="sr-only">
          {STR.searchLabel.en}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center">
          <div className="text-4xl">📢</div>
          <p lang="ar" dir="rtl" className="mt-3 text-zinc-600">
            {STR.empty.ar}
          </p>
          <p lang="fr" dir="ltr" className="mt-1 text-sm text-zinc-500">
            {STR.empty.fr}
          </p>
          <p lang="en" dir="ltr" className="mt-1 text-sm text-zinc-500">
            {STR.empty.en}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Link
              key={a.id}
              href={`/announcement/${a.id}`}
              className="block rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-600 focus-visible:outline-2 focus-visible:outline-emerald-700"
              aria-label={a.title}
            >
              <article>
                <h3 className="text-[17px] font-semibold text-zinc-900">{a.title}</h3>
                {a.date && (
                  <div className="mt-1 text-xs text-zinc-500">
                    <time dateTime={a.iso}>{a.date}</time>
                  </div>
                )}
                {a.excerpt && (
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                    {a.excerpt}
                  </p>
                )}
                <div className="mt-2 text-sm font-semibold text-emerald-700">
                  <span lang="ar" dir="rtl">
                    {STR.readMore.ar}
                  </span>
                  <span lang="fr" dir="ltr" className="sr-only">
                    {' '}
                    {STR.readMore.fr}
                  </span>
                  <span lang="en" dir="ltr" className="sr-only">
                    {' '}
                    {STR.readMore.en}
                  </span>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
