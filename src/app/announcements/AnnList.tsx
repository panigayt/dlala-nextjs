// Client component: announcement cards + local search.
//
// Mirrors ~/workspace/dlala-040/js/announcements.js behavior:
//   - Cards are clickable and open the full article at /announcement/[id].
//   - The search input filters the already-fetched list locally.
//   - Card shows localized title, date, 160-char excerpt, "read more".
//
// Round 120: UI strings go through the app-wide language store (useLang)
// so the header language switch re-renders this list — replaces the local
// hardcoded STR dict. Title/body/date follow the UI language (verbatim
// js/announcements.js annLocalized(map, lang) + js/app.js localeDateStr).

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLang, type Lang } from '@/lib/i18n';
import { annLocalized, annExcerpt } from '@/lib/firestore';

// Raw localized maps cross the server→client boundary (serializable);
// localization + date formatting happen here per UI language.
export interface AnnListItem {
  id: string;
  title: string | Record<string, string>;
  body: string | Record<string, string>;
  iso: string; // ISO date for the <time> element
}

// js/app.js localeDateStr parity: ar-DZ / fr-FR / en-US.
const DATE_LOCALE: Record<Lang, string> = { ar: 'ar-DZ', fr: 'fr-FR', en: 'en-US' };

function fmtDate(iso: string, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(DATE_LOCALE[lang]);
  } catch {
    return d.toLocaleDateString();
  }
}

export default function AnnList({ items }: { items: AnnListItem[] }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState('');

  const localized = useMemo(
    () =>
      items.map((a) => {
        const title = annLocalized(a.title, lang);
        const body = annLocalized(a.body, lang);
        return {
          id: a.id,
          title,
          body,
          date: fmtDate(a.iso, lang),
          iso: a.iso,
          excerpt: annExcerpt(body),
        };
      }),
    [items, lang]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return localized;
    return localized.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(needle));
  }, [q, localized]);

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('annSearchPh')}
          aria-label={t('annSearchPh')}
          autoComplete="off"
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center">
          <div className="text-4xl">📢</div>
          <p className="mt-3 text-zinc-600">{t('annSearchEmpty')}</p>
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
                <div className="mt-2 text-sm font-semibold text-emerald-700">{t('readMore')}</div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
