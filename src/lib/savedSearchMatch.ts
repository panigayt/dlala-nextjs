// Shared saved-search matching logic (Round 7, 18 Oct 2026).
// Extracted from src/app/alerts/page.tsx so SiteChrome can compute
// badge counts without duplicating the algorithm.

export interface SavedSearch {
  id: string;
  query?: string;
  categoryId?: string;
  wilayaCode?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  enabled?: boolean;
}

export interface FreshListing {
  id: string;
  title: unknown;
  description?: unknown;
  price?: number;
  categoryId?: string;
  wilayaCode?: number;
  isWanted?: boolean;
  createdAt?: unknown;
  photoUrls?: string[];
  photo_thumbs?: (string | null)[];
  thumbUrls?: string[];
}

export function tsMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
}

export function localizedTitle(title: unknown, lang: string = 'ar'): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const o = title as Record<string, string>;
    return o[lang] || o.ar || o.fr || o.en || '';
  }
  return '';
}

export function localizedDesc(desc: unknown, lang: string = 'ar'): string {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  if (typeof desc === 'object') {
    const o = desc as Record<string, string>;
    return o[lang] || o.ar || o.fr || o.en || '';
  }
  return '';
}

// Arabic-aware normalization — mirrors the legacy anti-duplicate
// normalization (tashkeel/tatweel stripped, alef/hamza unified, ة→ه,
// ى→ي, eastern digits→ASCII).
export function normAr(s: string): string {
  return String(s || '')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .toLowerCase()
    .trim();
}

export function matchesSavedSearch(l: FreshListing, s: SavedSearch): boolean {
  // Verbatim from js/market.js (line 143): wanted ads never match a
  // regular saved search — they have their own /wanted page.
  if (l.isWanted) return false;
  if (s.categoryId && l.categoryId !== s.categoryId) return false;
  if (s.wilayaCode != null && l.wilayaCode !== s.wilayaCode) return false;
  // AC-7 (Round 7, 18 Oct 2026): price-less listings (null/undefined/<=1,
  // the 1-DZD "negotiable" convention) are NOT treated as price 0.
  // A price-on-request listing could be in any range — skip the price
  // bounds check instead of excluding it.
  const lp = l.price;
  const hasPrice = lp != null && lp > 1;
  if (s.minPrice != null && hasPrice && (lp as number) < s.minPrice) return false;
  if (s.maxPrice != null && hasPrice && (lp as number) > s.maxPrice) return false;
  const q = normAr(s.query || '');
  if (q) {
    // 11 Oct 2026: search ALL language variants (was Arabic-only — FR/EN broken).
    // AC-8 (Round 7, 18 Oct 2026): also search descriptions, not just titles.
    const titles = typeof l.title === 'object' && l.title
      ? Object.values(l.title as Record<string, string>)
      : [localizedTitle(l.title)];
    const descs = typeof l.description === 'object' && l.description
      ? Object.values(l.description as Record<string, string>)
      : [localizedDesc(l.description)];
    const hay = titles.map((t) => normAr(t)).join(' ')
      + ' ' + descs.map((d) => normAr(d)).join(' ');
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every((tk) => hay.includes(tk))) return false;
  }
  return true;
}
