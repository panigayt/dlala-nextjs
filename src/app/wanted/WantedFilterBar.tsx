'use client';

// Wanted page filter bar — trilingual (js/wanted.js + js/i18n.js parity,
// Round 115).
//
// The wanted page is a Server Component; the search input placeholder,
// search button, "all categories" chip and category names must follow the
// UI language, so they live in this client island (same pattern as the
// WilayaSelect island from Round 87).

import Link from 'next/link';
import { useLang, type Lang } from '@/lib/i18n';
import { CATEGORIES } from '@/lib/categories';
import WilayaSelect from './WilayaSelect';

export interface WantedFilters {
  cat: string;
  wilaya: string;
  q: string;
}

function catName(
  c: { ar: string; fr: string; en: string },
  lang: Lang
): string {
  return c[lang] || c.ar;
}

export default function WantedFilterBar({ f }: { f: WantedFilters }) {
  const { t, lang } = useLang();

  const chipCls = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
      active
        ? 'bg-emerald-700 text-white'
        : 'bg-white text-zinc-700 border border-zinc-200 hover:border-emerald-400'
    }`;

  const params = (over: Partial<WantedFilters>) => {
    const p = new URLSearchParams();
    const nf = { ...f, ...over };
    if (nf.cat) p.set('cat', nf.cat);
    if (nf.wilaya) p.set('wilaya', nf.wilaya);
    if (nf.q) p.set('q', nf.q);
    const s = p.toString();
    return s ? `/wanted?${s}` : '/wanted';
  };

  return (
    <div className="mb-5 space-y-3">
      <form action="/wanted" method="get" className="flex gap-2">
        {f.cat ? <input type="hidden" name="cat" value={f.cat} /> : null}
        {f.wilaya ? (
          <input type="hidden" name="wilaya" value={f.wilaya} />
        ) : null}
        <input
          name="q"
          defaultValue={f.q}
          placeholder={t('search')}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base"
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-700 px-5 py-2.5 font-bold text-white hover:bg-emerald-800 transition-colors"
        >
          {t('searchBtn')}
        </button>
      </form>

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
      >
        <Link href={params({ cat: '' })} className={chipCls(!f.cat)}>
          {t('allCategories')}
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.id}
            href={params({ cat: c.id })}
            className={chipCls(f.cat === c.id)}
          >
            {catName(c, lang)}
          </Link>
        ))}
      </div>

      <WilayaSelect f={f} />
    </div>
  );
}
