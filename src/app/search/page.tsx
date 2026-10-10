// Dlala search — Server-Side Rendered.
//
// Query params: q (text), cat (category), wilaya, min/max (price), sort
// (recent | priceAsc | priceDesc). Structured filters run in Firestore;
// text query is normalized client-side-matching on the server
// (mirrors js/home.js R-9).

import { Suspense } from 'react';
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import {
  searchListingsWithCount,
  hasFacetFilter,
  facetPhoneBrandsForOs,
  FACET_CAR_BRANDS,
  type SearchResult,
  type SearchFilters,
} from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES } from '@/lib/categories';
import { brandLatinName } from '@/lib/seo';
import { pubT } from '@/lib/publish-strings';
import SaveSearchButton from './SaveSearchButton';
import SearchResultsGrid from './SearchResultsGrid';
import { parseSearchFilters } from './filters';

async function getResults(f: SearchFilters): Promise<SearchResult> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return searchListingsWithCount(f);
}

// Category facet row — mirrors js/home.js renderFacets() (0.0.0.43).
// Phones: OS + brand (brand list narrowed by OS at render time, like the
// legacy phoneBrandsForOs(F.fOs) call). Cars: brand + fuel + gearbox +
// year range + mileage range. Rendered only for phones/cars; every facet
// has an "All" option (Zak, 12 Sep 2026). Labels verbatim from
// js/i18n.ar.js (facetOs/facetBrand/facetFuel/facetGear/yearFrom/yearTo/
// mileageFrom/mileageTo). Lives inside the FilterBar GET form so facets
// submit as URL params alongside the other filters.
function FacetBar({ filters }: { filters: SearchFilters }) {
  const ctl =
    'rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900';
  const t = (k: string) => pubT(k, 'ar');
  if (filters.cat === 'phones') {
    return (
      <>
        <label htmlFor="search-fOs" className="sr-only">
          نظام التشغيل
        </label>
        <select id="search-fOs" name="fOs" className={ctl} defaultValue={filters.fOs || ''}>
          <option value="">نظام التشغيل</option>
          <option value="osAndroid">{t('osAndroid')}</option>
          <option value="osIos">{t('osIos')}</option>
        </select>
        <label htmlFor="search-fBrand" className="sr-only">
          الماركة
        </label>
        <select id="search-fBrand" name="fBrand" className={ctl} defaultValue={filters.fBrand || ''}>
          <option value="">الماركة</option>
          {facetPhoneBrandsForOs(filters.fOs || '').map((b) => (
            <option key={b} value={b}>
              {brandLatinName(b)}
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
          الماركة
        </label>
        <select
          id="search-fCarBrand"
          name="fCarBrand"
          className={ctl}
          defaultValue={filters.fCarBrand || ''}
        >
          <option value="">الماركة</option>
          {FACET_CAR_BRANDS.map((b) => (
            <option key={b} value={b}>
              {brandLatinName(b)}
            </option>
          ))}
        </select>
        <label htmlFor="search-fFuel" className="sr-only">
          الوقود
        </label>
        <select id="search-fFuel" name="fFuel" className={ctl} defaultValue={filters.fFuel || ''}>
          <option value="">الوقود</option>
          <option value="fuelPetrol">{t('fuelPetrol')}</option>
          <option value="fuelDiesel">{t('fuelDiesel')}</option>
          <option value="fuelGas">{t('fuelGas')}</option>
          <option value="fuelElectric">{t('fuelElectric')}</option>
        </select>
        <label htmlFor="search-fGear" className="sr-only">
          ناقل الحركة
        </label>
        <select id="search-fGear" name="fGear" className={ctl} defaultValue={filters.fGear || ''}>
          <option value="">ناقل الحركة</option>
          <option value="gearManual">{t('gearManual')}</option>
          <option value="gearAuto">{t('gearAuto')}</option>
        </select>
        <label htmlFor="search-fYearMin" className="sr-only">
          السنة من
        </label>
        <input
          id="search-fYearMin"
          type="number"
          name="fYearMin"
          min="1950"
          max="2030"
          inputMode="numeric"
          placeholder="السنة من"
          defaultValue={filters.fYearMin || ''}
          className={`${ctl} w-28`}
        />
        <label htmlFor="search-fYearMax" className="sr-only">
          إلى
        </label>
        <input
          id="search-fYearMax"
          type="number"
          name="fYearMax"
          min="1950"
          max="2030"
          inputMode="numeric"
          placeholder="إلى"
          defaultValue={filters.fYearMax || ''}
          className={`${ctl} w-24`}
        />
        <label htmlFor="search-fMilMin" className="sr-only">
          الكيلومترات من
        </label>
        <input
          id="search-fMilMin"
          type="number"
          name="fMilMin"
          min="0"
          inputMode="numeric"
          placeholder="الكيلومترات من"
          defaultValue={filters.fMilMin || ''}
          className={`${ctl} w-36`}
        />
        <label htmlFor="search-fMilMax" className="sr-only">
          إلى
        </label>
        <input
          id="search-fMilMax"
          type="number"
          name="fMilMax"
          min="0"
          inputMode="numeric"
          placeholder="إلى"
          defaultValue={filters.fMilMax || ''}
          className={`${ctl} w-24`}
        />
      </>
    );
  }
  return null;
}

// Filter bar — GET form mirroring the home page HomeFilters block
// (~/workspace/dlala-040/index.html .filters). Backend already supports
// cat/wilaya/min/max/sort via URL params; this is the UI for them.
// Current values are pre-selected via defaultValue; the text query q
// is preserved in a hidden input.
function FilterBar({ filters }: { filters: SearchFilters }) {
  const ctl =
    'rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900';
  const q = filters.q || '';
  return (
    <form action="/search" method="get" className="flex flex-wrap items-center gap-2 mb-4">
      {q ? <input type="hidden" name="q" value={q} /> : null}
      <label htmlFor="search-cat" className="sr-only">
        الفئة
      </label>
      <select id="search-cat" name="cat" className={ctl} defaultValue={filters.cat || ''}>
        <option value="">كل الفئات</option>
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.ar}
          </option>
        ))}
      </select>
      <label htmlFor="search-wilaya" className="sr-only">
        الولاية
      </label>
      <select id="search-wilaya" name="wilaya" className={ctl} defaultValue={filters.wilaya || ''}>
        <option value="">كل الولايات</option>
        {(WILAYAS as { code: number; ar: string }[]).map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} - {w.ar}
          </option>
        ))}
      </select>
      <label htmlFor="search-min" className="sr-only">
        السعر الأدنى
      </label>
      <input
        id="search-min"
        type="number"
        name="min"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأدنى"
        defaultValue={filters.min || ''}
        className={`${ctl} w-32`}
      />
      <label htmlFor="search-max" className="sr-only">
        السعر الأقصى
      </label>
      <input
        id="search-max"
        type="number"
        name="max"
        min="0"
        inputMode="numeric"
        placeholder="السعر الأقصى"
        defaultValue={filters.max || ''}
        className={`${ctl} w-32`}
      />
      <label htmlFor="search-sort" className="sr-only">
        ترتيب
      </label>
      <select id="search-sort" name="sort" className={ctl} defaultValue={filters.sort || 'recent'}>
        <option value="recent">الأحدث</option>
        <option value="priceAsc">السعر: من الأقل</option>
        <option value="priceDesc">السعر: من الأعلى</option>
      </select>
      <FacetBar filters={filters} />
      <button
        type="submit"
        className="rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-bold text-white hover:bg-emerald-800"
      >
        تطبيق
      </button>
      <Link
        href={q ? `/search?q=${encodeURIComponent(q)}` : '/search'}
        className="rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-base text-zinc-700 hover:border-emerald-600"
      >
        مسح
      </Link>
    </form>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-emerald-700 text-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">دلالة</Link>
        <form action="/search" method="get" className="flex gap-2">
          <input
            type="search"
            name="q"
            placeholder="ابحث..."
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-900 w-40 sm:w-64"
          />
          <button type="submit" className="rounded-lg bg-emerald-900 px-4 py-1.5 text-sm font-medium">
            بحث
          </button>
        </form>
      </div>
    </header>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
          <div className="p-3">
            <div className="h-5 bg-zinc-200 rounded animate-pulse w-1/2" />
            <div className="mt-2 h-4 bg-zinc-200 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function Results({ filters }: { filters: SearchFilters }) {
  let data: SearchResult | null = null;
  let error: string | null = null;
  try {
    data = await getResults(filters);
  } catch (e) {
    error = e instanceof Error ? e.message : 'search-error';
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-6 text-center text-red-700">
        تعذر البحث ({error}).
      </div>
    );
  }

  return (
    <SearchResultsGrid
      initialListings={data.listings}
      initialTotal={data.total}
      initialHasMore={data.hasMore}
      filters={filters}
    />
  );
}

async function SearchContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseSearchFilters(sp);
  const hasFilter =
    filters.q ||
    filters.cat ||
    filters.wilaya ||
    filters.min ||
    filters.max ||
    filters.sort ||
    hasFacetFilter(filters);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <h2 className="text-lg font-semibold text-zinc-800 mb-4">
        {filters.q ? `نتائج البحث: "${filters.q}"` : 'البحث'}
      </h2>
      <FilterBar filters={filters} />
      {hasFilter ? <SaveSearchButton filters={filters} /> : null}
      {hasFilter ? (
        <Results filters={filters} />
      ) : (
        <div className="rounded-xl bg-white p-8 text-center text-zinc-500">
          <p>اكتب كلمة للبحث في الإعلانات.</p>
        </div>
      )}
    </main>
  );
}

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <Header />
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
