'use client';

// Home page header block: search bar + category chips + filters.
//
// Round 157 (critical parity fix): production 0.0.0.39 filters the homepage
// feed IN PLACE — apply() → loadFeed() never navigates. The Round 155
// approach (GET form submit to /search on select change) was wrong:
// selecting a wilaya must reload the feed on /, not open the search page.
// This component is now fully controlled: every filter change calls
// onFiltersChange(filters) and HomePage refetches /api/search and repaints
// the feed in place (js/home.js apply()/loadFeed() parity).
//
// Production behavior mirrored (js/home.js):
// - Chips are <button>s: set F.cat (+ clearFacets), renderChips, loadFeed.
// - Dropdowns (wilaya/sort/facets) apply instantly on change (0.0.0.1l).
// - Search text: 450ms debounced live apply; Enter applies immediately.
// - Price/year/mileage text inputs: the Apply button.
// - Changing OS narrows the brand list, keeping the brand if still valid.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import { useLang } from '@/lib/i18n';
import {
  facetPhoneBrandsForOs,
  FACET_CAR_BRANDS,
  type SearchFilters,
} from '@/lib/firestore';
import { brandLatinName } from '@/lib/seo';

type Wilaya = { code: number; ar: string; fr: string; en: string };

const CTL =
  // Round 6 (18 Oct 2026): min-h 44px touch target (was ~42px).
  'rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-[9px] text-base text-zinc-900 min-h-[44px]';

function SearchBar({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilters;
  onFiltersChange: (f: SearchFilters) => void;
}) {
  const { t } = useLang();
  const [q, setQ] = useState(filters.q || '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const applyQ = (val: string) =>
    onFiltersChange({ ...filters, q: val.trim() ? val : undefined });
  return (
    <form
      role="search"
      className="flex gap-2 mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        applyQ(q);
      }}
    >
      <label htmlFor="home-q" className="sr-only">
        {t('search')}
      </label>
      <input
        id="home-q"
        type="search"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          if (timer.current) clearTimeout(timer.current);
          // 0.0.0.31 D-6: debounced live search — 450ms after last keystroke.
          timer.current = setTimeout(() => applyQ(v), 450);
        }}
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

function CategoryChips({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilters;
  onFiltersChange: (f: SearchFilters) => void;
}) {
  const { t, lang } = useLang();
  // Production clearFacets(): stale facet values never carry across categories.
  const setCat = (cat: string | undefined) =>
    onFiltersChange({
      ...filters,
      cat,
      fOs: undefined,
      fBrand: undefined,
      fCarBrand: undefined,
      fFuel: undefined,
      fGear: undefined,
      fYearMin: undefined,
      fYearMax: undefined,
      fMilMin: undefined,
      fMilMax: undefined,
    });
  const chip = (active: boolean) =>
    // Round 6 (18 Oct 2026): min-h/w 44px touch target (was ~36px).
    `whitespace-nowrap shrink-0 rounded-full border px-4 py-2 text-sm min-h-[44px] min-w-[44px] inline-flex items-center justify-center ${
      active
        ? 'border-emerald-700 bg-emerald-700 font-bold text-white'
        : 'border-zinc-300 bg-white text-zinc-800 hover:border-emerald-600'
    }`;
  return (
    <nav aria-label={t('categoriesNav')} className="flex gap-2 overflow-x-auto pb-3 mb-2">
      <button
        type="button"
        aria-current={!filters.cat ? 'page' : undefined}
        onClick={() => setCat(undefined)}
        className={chip(!filters.cat)}
      >
        {t('allCategories')}
      </button>
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-current={filters.cat === c.id ? 'page' : undefined}
          onClick={() => setCat(c.id)}
          className={chip(filters.cat === c.id)}
        >
          {c[lang as keyof typeof c] || c.ar}
        </button>
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

// Category facet selects — mirrors js/home.js renderFacets() + the
// SearchPage FacetBar (phones: OS+brand; cars: brand+fuel+gear+year+mileage).
// All selects auto-apply on change (0.0.0.1l); text inputs use Apply.
function HomeFacetBar({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilters;
  onFiltersChange: (f: SearchFilters) => void;
}) {
  const { t, lang } = useLang();
  const sel = (upd: Partial<SearchFilters>) =>
    onFiltersChange({ ...filters, ...upd });
  if (filters.cat === 'phones') {
    const brands = facetPhoneBrandsForOs(filters.fOs || '');
    return (
      <>
        <label htmlFor="home-fOs" className="sr-only">
          {t('facetOs')}
        </label>
        <select
          id="home-fOs"
          className={CTL}
          value={filters.fOs || ''}
          onChange={(e) => {
            const os = e.target.value || undefined;
            // Production: narrowing the brand list keeps the brand only if
            // still valid, otherwise clears it.
            const nb = facetPhoneBrandsForOs(os || '');
            const brand = filters.fBrand && nb.includes(filters.fBrand) ? filters.fBrand : undefined;
            onFiltersChange({ ...filters, fOs: os, fBrand: brand });
          }}
        >
          <option value="">{t('facetOs')}</option>
          <option value="osAndroid">{t('osAndroid')}</option>
          <option value="osIos">{t('osIos')}</option>
        </select>
        <label htmlFor="home-fBrand" className="sr-only">
          {t('facetBrand')}
        </label>
        <select
          id="home-fBrand"
          className={CTL}
          value={filters.fBrand || ''}
          onChange={(e) => sel({ fBrand: e.target.value || undefined })}
        >
          <option value="">{t('facetBrand')}</option>
          {brands.map((b) => (
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
        <label htmlFor="home-fCarBrand" className="sr-only">
          {t('facetBrand')}
        </label>
        <select
          id="home-fCarBrand"
          className={CTL}
          value={filters.fCarBrand || ''}
          onChange={(e) => sel({ fCarBrand: e.target.value || undefined })}
        >
          <option value="">{t('facetBrand')}</option>
          {FACET_CAR_BRANDS.map((b) => (
            <option key={b} value={b}>
              {brandLatinName(b, lang)}
            </option>
          ))}
        </select>
        <label htmlFor="home-fFuel" className="sr-only">
          {t('facetFuel')}
        </label>
        <select
          id="home-fFuel"
          className={CTL}
          value={filters.fFuel || ''}
          onChange={(e) => sel({ fFuel: e.target.value || undefined })}
        >
          <option value="">{t('facetFuel')}</option>
          <option value="fuelPetrol">{t('fuelPetrol')}</option>
          <option value="fuelDiesel">{t('fuelDiesel')}</option>
          <option value="fuelGas">{t('fuelGas')}</option>
          <option value="fuelElectric">{t('fuelElectric')}</option>
        </select>
        <label htmlFor="home-fGear" className="sr-only">
          {t('facetGear')}
        </label>
        <select
          id="home-fGear"
          className={CTL}
          value={filters.fGear || ''}
          onChange={(e) => sel({ fGear: e.target.value || undefined })}
        >
          <option value="">{t('facetGear')}</option>
          <option value="gearManual">{t('gearManual')}</option>
          <option value="gearAuto">{t('gearAuto')}</option>
        </select>
        <label htmlFor="home-fYearMin" className="sr-only">
          {t('yearFrom')}
        </label>
        <input
          id="home-fYearMin"
          type="number"
          min="1950"
          max="2030"
          inputMode="numeric"
          placeholder={t('yearFrom')}
          value={filters.fYearMin || ''}
          onChange={(e) => onFiltersChange({ ...filters, fYearMin: e.target.value || undefined })}
          className={`${CTL} w-28`}
        />
        <label htmlFor="home-fYearMax" className="sr-only">
          {t('yearTo')}
        </label>
        <input
          id="home-fYearMax"
          type="number"
          min="1950"
          max="2030"
          inputMode="numeric"
          placeholder={t('yearTo')}
          value={filters.fYearMax || ''}
          onChange={(e) => onFiltersChange({ ...filters, fYearMax: e.target.value || undefined })}
          className={`${CTL} w-24`}
        />
        <label htmlFor="home-fMilMin" className="sr-only">
          {t('mileageFrom')}
        </label>
        <input
          id="home-fMilMin"
          type="number"
          min="0"
          inputMode="numeric"
          placeholder={t('mileageFrom')}
          value={filters.fMilMin || ''}
          onChange={(e) => onFiltersChange({ ...filters, fMilMin: e.target.value || undefined })}
          className={`${CTL} w-36`}
        />
        <label htmlFor="home-fMilMax" className="sr-only">
          {t('mileageTo')}
        </label>
        <input
          id="home-fMilMax"
          type="number"
          min="0"
          inputMode="numeric"
          placeholder={t('mileageTo')}
          value={filters.fMilMax || ''}
          onChange={(e) => onFiltersChange({ ...filters, fMilMax: e.target.value || undefined })}
          className={`${CTL} w-24`}
        />
      </>
    );
  }
  return null;
}

function HomeFilters({
  filters,
  onFiltersChange,
}: {
  filters: SearchFilters;
  onFiltersChange: (f: SearchFilters) => void;
}) {
  const { t, lang } = useLang();
  const set = (upd: Partial<SearchFilters>) => onFiltersChange({ ...filters, ...upd });
  const clean = (v: string) => (v ? v : undefined);
  return (
    <form
      // Round 157: no navigation — submit applies in place (text inputs).
      onSubmit={(e) => {
        e.preventDefault();
        onFiltersChange({ ...filters });
      }}
      className="flex flex-wrap items-center gap-2 mb-4 bg-white border border-[#e5e7eb] rounded-xl p-3"
    >
      <label htmlFor="home-wilaya" className="sr-only">
        {t('wilaya')}
      </label>
      <select
        id="home-wilaya"
        className={CTL}
        value={filters.wilaya || ''}
        onChange={(e) => set({ wilaya: clean(e.target.value) })}
      >
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
        min="0"
        inputMode="numeric"
        placeholder={t('minPrice')}
        value={filters.min || ''}
        onChange={(e) => set({ min: clean(e.target.value) })}
        className={`${CTL} w-32`}
      />
      <label htmlFor="home-max" className="sr-only">
        {t('maxPrice')}
      </label>
      <input
        id="home-max"
        type="number"
        min="0"
        inputMode="numeric"
        placeholder={t('maxPrice')}
        value={filters.max || ''}
        onChange={(e) => set({ max: clean(e.target.value) })}
        className={`${CTL} w-32`}
      />
      <label htmlFor="home-sort" className="sr-only">
        {t('sortLabel')}
      </label>
      <select
        id="home-sort"
        className={CTL}
        value={filters.sort || 'recent'}
        onChange={(e) => set({ sort: e.target.value || undefined })}
      >
        <option value="recent">{t('sortRecent')}</option>
        <option value="priceAsc">{t('sortPriceAsc')}</option>
        <option value="priceDesc">{t('sortPriceDesc')}</option>
      </select>
      <HomeFacetBar filters={filters} onFiltersChange={onFiltersChange} />
      {/* Round 152: buttons stay together as a unit — 0.0.0.39 parity. */}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
        >
          {t('applyFilters')}
        </button>
        <button
          type="button"
          onClick={() => onFiltersChange({})}
          className="rounded-xl border border-zinc-300 bg-white px-5 py-3 text-base text-zinc-700 hover:border-emerald-600 whitespace-nowrap"
        >
          {t('resetFilters')}
        </button>
      </div>
    </form>
  );
}

export default function HomeHeader({
  filters,
  onFiltersChange,
  resetKey,
}: {
  filters: SearchFilters;
  onFiltersChange: (f: SearchFilters) => void;
  resetKey: number;
}) {
  return (
    <>
      {/* resetKey remounts the search input when filters reset externally. */}
      <SearchBar key={resetKey} filters={filters} onFiltersChange={onFiltersChange} />
      <CategoryChips filters={filters} onFiltersChange={onFiltersChange} />
      <HomeFilters filters={filters} onFiltersChange={onFiltersChange} />
    </>
  );
}
