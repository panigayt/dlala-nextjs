'use client';

// Home page header block: search bar + category chips + filters.
//
// Round 107: extracted from src/app/page.tsx (server) into a client
// component so every string follows the UI language via useLang()
// (js/i18n.js onLangChange parity). GET forms submit to /search natively,
// like the legacy SPA's filter application.
//
// Legacy parity notes:
// - Search bar mirrors ~/workspace/dlala-040/index.html .search-bar
//   (data-i18n="search" / "searchBtn").
// - Chips mirror renderChips() in js/home.js: t('allCategories') +
//   22 categories (c[LANG]) + 🔎 t('wantedOnly') → /wanted.
// - Filters mirror the .filters block in index.html (wilaya select,
//   min/max price, sort, apply/reset) with data-i18n keys verbatim.

import Link from 'next/link';
import { useRef } from 'react';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import { useLang } from '@/lib/i18n';

type Wilaya = { code: number; ar: string; fr: string; en: string };

function SearchBar() {
  const { t } = useLang();
  return (
    <form action="/search" method="get" role="search" className="flex gap-2 mb-4">
      <label htmlFor="home-q" className="sr-only">
        {t('search')}
      </label>
      <input
        id="home-q"
        type="search"
        name="q"
        placeholder={t('search')}
        autoComplete="off"
        className="flex-1 min-w-0 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-900"
      />
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-6 py-3 font-bold text-white hover:bg-emerald-800"
      >
        {t('searchBtn')}
      </button>
    </form>
  );
}

function CategoryChips() {
  const { t, lang } = useLang();
  return (
    <nav aria-label={t('categoriesNav')} className="flex gap-2 overflow-x-auto pb-3 mb-2">
      <Link
        href="/search"
        aria-current="page"
        className="whitespace-nowrap rounded-full border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
      >
        {t('allCategories')}
      </Link>
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`/search?cat=${c.id}`}
          className="whitespace-nowrap rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:border-emerald-600"
        >
          {c[lang as keyof typeof c] || c.ar}
        </Link>
      ))}
      <Link
        href="/wanted"
        className="whitespace-nowrap rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:border-emerald-600"
      >
        🔎 {t('wantedOnly')}
      </Link>
    </nav>
  );
}

function HomeFilters() {
  const { t, lang } = useLang();
  const formRef = useRef<HTMLFormElement>(null);
  const ctl =
    'rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-[9px] text-base text-zinc-900';
  return (
    <form
      ref={formRef}
      action="/search"
      method="get"
      // Round 155 — 0.0.0.43 parity (Zak «في كل الفلاتر»): dropdowns apply
      // instantly on change, no Apply tap needed. Price text inputs still
      // use the Apply button. Delegated like legacy's document-level change
      // listener (js/home.js:2606-2612).
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === 'SELECT') {
          const f = formRef.current;
          if (f) {
            if (typeof f.requestSubmit === 'function') f.requestSubmit();
            else f.submit();
          }
        }
      }}
      className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-[#e5e7eb] rounded-xl p-3"
    >
      <label htmlFor="home-wilaya" className="sr-only">
        {t('wilaya')}
      </label>
      <select id="home-wilaya" name="wilaya" className={ctl} defaultValue="">
        <option value="">{t('allWilayas')}</option>
        {(WILAYAS as Wilaya[]).map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} - {w[lang as keyof Wilaya] || w.ar}
          </option>
        ))}
      </select>
      <label htmlFor="home-min" className="sr-only">
        {t('minPrice')}
      </label>
      <input
        id="home-min"
        type="number"
        name="min"
        min="0"
        inputMode="numeric"
        placeholder={t('minPrice')}
        className={`${ctl} w-32`}
      />
      <label htmlFor="home-max" className="sr-only">
        {t('maxPrice')}
      </label>
      <input
        id="home-max"
        type="number"
        name="max"
        min="0"
        inputMode="numeric"
        placeholder={t('maxPrice')}
        className={`${ctl} w-32`}
      />
      <label htmlFor="home-sort" className="sr-only">
        {t('sortLabel')}
      </label>
      <select id="home-sort" name="sort" className={ctl} defaultValue="recent">
        <option value="recent">{t('sortRecent')}</option>
        <option value="priceAsc">{t('sortPriceAsc')}</option>
        <option value="priceDesc">{t('sortPriceDesc')}</option>
      </select>
      {/* Round 152: buttons stay together as a unit — 0.0.0.39 parity. */}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
        >
          {t('applyFilters')}
        </button>
        <button
          type="reset"
          className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-base text-zinc-700 hover:border-emerald-600 whitespace-nowrap"
        >
          {t('resetFilters')}
        </button>
      </div>
    </form>
  );
}

export default function HomeHeader() {
  return (
    <>
      <SearchBar />
      <CategoryChips />
      <HomeFilters />
    </>
  );
}
