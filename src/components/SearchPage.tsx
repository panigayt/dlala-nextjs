'use client';

// Search page client shell — Round 109.
//
// The server (src/app/search/page.tsx) parses the URL filters and fetches
// the results; this client component owns everything language-dependent:
// text direction, the heading, the filter bar (+ category facets), the
// save-search button, the results grid, and the error/empty states. On a
// language switch every mounted useLang() consumer re-renders (Round 106
// app-wide store), so the whole search page flips AR/FR/EN without a
// reload — js/i18n.js onLangChange() parity (same pattern as the home
// page, Round 107).
//
// The shell is keyed by the filter query string (page.tsx), so it remounts
// on every filter navigation — select defaultValues are always fresh,
// exactly like the previous server-rendered version.

import Link from 'next/link';
import { useRef } from 'react';
import { useLang } from '@/lib/i18n';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES, catName } from '@/lib/categories';
import { brandLatinName } from '@/lib/seo';
import {
  facetPhoneBrandsForOs,
  FACET_CAR_BRANDS,
  type SearchFilters,
  type SearchResult,
} from '@/lib/firestore';
import SearchResultsGrid from '@/app/search/SearchResultsGrid';
// Round 18 BK-obs2: inline "not a number" hint for junk filter values.
import NumericFilterInput, { isJunkNumeric } from './NumericFilterInput';

type Wilaya = { code: number; ar: string; fr: string; en: string };

const CTL =
  'rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900';

// Category facet row — mirrors js/home.js renderFacets() (0.0.0.43).
// Phones: OS + brand (brand list narrowed by OS at render time, like the
// legacy phoneBrandsForOs(F.fOs) call). Cars: brand + fuel + gearbox +
// year range + mileage range. Rendered only for phones/cars; every facet
// has an "All" option (Zak, 12 Sep 2026). Labels via t() — verbatim
// js/i18n.{ar,fr,en}.js (facetOs/facetBrand/facetFuel/facetGear/yearFrom/
// yearTo/mileageFrom/mileageTo). Lives inside the FilterBar GET form so
// facets submit as URL params alongside the other filters.
function FacetBar({ filters }: { filters: SearchFilters }) {
  const { t, lang } = useLang();
  if (filters.cat === 'phones') {
    return (
      <>
        <label htmlFor="search-fOs" className="sr-only">
          {t('facetOs')}
        </label>
        <select id="search-fOs" name="fOs" className={CTL} defaultValue={filters.fOs || ''}>
          <option value="">{t('facetOs')}</option>
          <option value="osAndroid">{t('osAndroid')}</option>
          <option value="osIos">{t('osIos')}</option>
        </select>
        <label htmlFor="search-fBrand" className="sr-only">
          {t('facetBrand')}
        </label>
        <select
          id="search-fBrand"
          name="fBrand"
          className={CTL}
          defaultValue={filters.fBrand || ''}
        >
          <option value="">{t('facetBrand')}</option>
          {facetPhoneBrandsForOs(filters.fOs || '').map((b) => (
            <option key={b} value={b}>
              {brandLatinName(b, lang)}
            </option>
          ))}
        </select>
      </>
    );
  }
  if (filters.cat === 'cars') {
    return (
      <>
        <label htmlFor="search-fCarBrand" className="sr-only">
          {t('facetBrand')}
        </label>
        <select
          id="search-fCarBrand"
          name="fCarBrand"
          className={CTL}
          defaultValue={filters.fCarBrand || ''}
        >
          <option value="">{t('facetBrand')}</option>
          {FACET_CAR_BRANDS.map((b) => (
            <option key={b} value={b}>
              {brandLatinName(b, lang)}
            </option>
          ))}
        </select>
        <label htmlFor="search-fFuel" className="sr-only">
          {t('facetFuel')}
        </label>
        <select id="search-fFuel" name="fFuel" className={CTL} defaultValue={filters.fFuel || ''}>
          <option value="">{t('facetFuel')}</option>
          <option value="fuelPetrol">{t('fuelPetrol')}</option>
          <option value="fuelDiesel">{t('fuelDiesel')}</option>
          <option value="fuelGas">{t('fuelGas')}</option>
          <option value="fuelElectric">{t('fuelElectric')}</option>
        </select>
        <label htmlFor="search-fGear" className="sr-only">
          {t('facetGear')}
        </label>
        <select id="search-fGear" name="fGear" className={CTL} defaultValue={filters.fGear || ''}>
          <option value="">{t('facetGear')}</option>
          <option value="gearManual">{t('gearManual')}</option>
          <option value="gearAuto">{t('gearAuto')}</option>
        </select>
        <label htmlFor="search-fYearMin" className="sr-only">
          {t('yearFrom')}
        </label>
        <NumericFilterInput
          id="search-fYearMin"
          name="fYearMin"
          min="1950"
          max="2030"
          placeholder={t('yearFrom')}
          defaultValue={filters.fYearMin || ''}
          invalid={isJunkNumeric(filters.fYearMin)}
          className={`${CTL} w-28`}
        />
        <label htmlFor="search-fYearMax" className="sr-only">
          {t('yearTo')}
        </label>
        <NumericFilterInput
          id="search-fYearMax"
          name="fYearMax"
          min="1950"
          max="2030"
          placeholder={t('yearTo')}
          defaultValue={filters.fYearMax || ''}
          invalid={isJunkNumeric(filters.fYearMax)}
          className={`${CTL} w-24`}
        />
        <label htmlFor="search-fMilMin" className="sr-only">
          {t('mileageFrom')}
        </label>
        <NumericFilterInput
          id="search-fMilMin"
          name="fMilMin"
          min="0"
          placeholder={t('mileageFrom')}
          defaultValue={filters.fMilMin || ''}
          invalid={isJunkNumeric(filters.fMilMin)}
          className={`${CTL} w-36`}
        />
        <label htmlFor="search-fMilMax" className="sr-only">
          {t('mileageTo')}
        </label>
        <NumericFilterInput
          id="search-fMilMax"
          name="fMilMax"
          min="0"
          placeholder={t('mileageTo')}
          defaultValue={filters.fMilMax || ''}
          invalid={isJunkNumeric(filters.fMilMax)}
          className={`${CTL} w-24`}
        />
      </>
    );
  }
  return null;
}

// Filter bar — GET form mirroring the home page HomeFilters block
// (~/workspace/dlala-040/index.html .filters). Backend already supports
// cat/wilaya/min/max/sort via URL params; this is the UI for them.
// Current values are pre-selected via defaultValue (the shell remounts on
// every filter navigation, so they are always fresh).
// R21-1 fix (23 Oct 2026): the text query q is a VISIBLE input — the
// homepage SearchBar row (same strings, styling and GET-to-/search
// mechanism) as the form's first row. Before, q existed only as a hidden
// field when it was already in the URL, so the bare /search page told the
// visitor «اكتب كلمة للبحث في الإعلانات» (t('searchEmpty')) with no field
// anywhere on the page to type that word into. The visible input submits
// with the rest of the form, preserving the other filters exactly as the
// hidden field did.
function FilterBar({ filters }: { filters: SearchFilters }) {
  const { t, lang } = useLang();
  const formRef = useRef<HTMLFormElement>(null);
  const q = filters.q || '';
  return (
    <form
      ref={formRef}
      action="/search"
      method="get"
      // Round 155 — 0.0.0.43 parity (Zak «في كل الفلاتر»): every dropdown
      // (category, wilaya, sort, phone OS/brand, car brand/fuel/gearbox)
      // applies instantly on change. Text inputs (min/max, year, mileage)
      // still use the Apply button. Delegated like legacy's document-level
      // change listener (js/home.js:2606-2612); this also covers the
      // FacetBar selects rendered inside this form.
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === 'SELECT') {
          const f = formRef.current;
          if (f) {
            if (typeof f.requestSubmit === 'function') f.requestSubmit();
            else f.submit();
          }
        }
      }}
      className="flex flex-wrap items-center gap-2 mb-4"
    >
      <div className="flex w-full gap-2">
        <label htmlFor="search-q" className="sr-only">
          {t('search')}
        </label>
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={q}
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
      </div>
      <label htmlFor="search-cat" className="sr-only">
        {t('allCategories')}
      </label>
      <select id="search-cat" name="cat" className={CTL} defaultValue={filters.cat || ''}>
        <option value="">{t('allCategories')}</option>
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {catName(c.id, lang)}
          </option>
        ))}
      </select>
      <label htmlFor="search-wilaya" className="sr-only">
        {t('wilaya')}
      </label>
      <select id="search-wilaya" name="wilaya" className={CTL} defaultValue={filters.wilaya || ''}>
        <option value="">{t('allWilayas')}</option>
        {(WILAYAS as Wilaya[]).map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} - {w[lang] || w.ar}
          </option>
        ))}
      </select>
      <label htmlFor="search-min" className="sr-only">
        {t('minPrice')}
      </label>
      <NumericFilterInput
        id="search-min"
        name="min"
        min="0"
        placeholder={t('minPrice')}
        defaultValue={filters.min || ''}
        invalid={isJunkNumeric(filters.min)}
        className={`${CTL} w-32`}
      />
      <label htmlFor="search-max" className="sr-only">
        {t('maxPrice')}
      </label>
      <NumericFilterInput
        id="search-max"
        name="max"
        min="0"
        placeholder={t('maxPrice')}
        defaultValue={filters.max || ''}
        invalid={isJunkNumeric(filters.max)}
        className={`${CTL} w-32`}
      />
      <label htmlFor="search-sort" className="sr-only">
        {t('sortLabel')}
      </label>
      <select id="search-sort" name="sort" className={CTL} defaultValue={filters.sort || 'recent'}>
        <option value="recent">{t('sortRecent')}</option>
        <option value="priceAsc">{t('sortPriceAsc')}</option>
        <option value="priceDesc">{t('sortPriceDesc')}</option>
      </select>
      <FacetBar filters={filters} />
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-bold text-white hover:bg-emerald-800"
      >
        {t('applyFilters')}
      </button>
      <Link
        href={q ? `/search?q=${encodeURIComponent(q)}` : '/search'}
        className="rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-base text-zinc-700 hover:border-emerald-600"
      >
        {t('resetFilters')}
      </Link>
    </form>
  );
}

export default function SearchPage({
  filters,
  data,
  error,
  hasFilter,
}: {
  filters: SearchFilters;
  data: SearchResult | null;
  error: string | null;
  hasFilter: boolean;
}) {
  const { t, lang } = useLang();

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 py-6">
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">
          {filters.q ? `${t('searchResultsFor')}: "${filters.q}"` : t('searchTitle')}
        </h2>
        <FilterBar filters={filters} />
        {hasFilter ? (
          error || !data ? (
            <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
              {/* 11 Oct 2026: no raw error leak — technical details stay in console. */}
              {t('searchFailed')}.
            </div>
          ) : (
            <SearchResultsGrid
              initialListings={data.listings}
              initialTotal={data.total}
              initialHasMore={data.hasMore}
              filters={filters}
            />
          )
        ) : (
          <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
            <p>{t('searchEmpty')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
