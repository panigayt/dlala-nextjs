// js/market.js — matchingOffers (verbatim logic, Round 86).
//
// Wanted ads (مطلوب): reverse-matched regular offers — same category,
// ≥2 significant title words in common, not mine, not sold. Rendered on
// the wanted listing page under the «عروض مطابقة لطلبك» heading
// (js/listing.js loadMatches, isWanted branch).

import { normalizeListingTitle } from './duplicates';

// 0.0.0.31 FIX-WEB-020: AR/FR stop words — without them «سيارة»/«voiture»
// matched nearly every ad, and ONE shared word (e.g. the year) was enough
// to pair «Symbol 2018» with «Clio 2019».
const STOP_WORDS = new Set([
  // Arabic
  'سيارة', 'سيارات', 'للبيع', 'بيع', 'جديد', 'جديدة', 'مستعمل', 'مستعملة',
  'حالة', 'جيدة', 'ممتازة', 'ممتاز', 'مع', 'في', 'من', 'على', 'إلى', 'الى',
  'هذا', 'هذه', 'التي', 'الذي', 'للتواصل', 'رقم', 'الهاتف', 'هاتف', 'متوفر',
  'متوفرة', 'عرض', 'عروض', 'مطلوب', 'بحالة', 'نظيفة', 'نظيف', 'أصلية',
  // French
  'voiture', 'voitures', 'vente', 'vendre', 'neuf', 'neuve', 'occasion',
  'bon', 'bonne', 'etat', 'état', 'avec', 'pour', 'dans', 'sur', 'les',
  'des', 'une', 'prix', 'contact', 'disponible', 'offre', 'offres',
  'recherche', 'propre', 'origine', 'année',
]);

export function significantWords(text: unknown): Set<string> {
  return new Set(
    String(text || '').toLowerCase()
      .split(/[^\p{L}0-9]+/u)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

export interface MatchCandidate {
  id?: string;
  title?: unknown;
  isWanted?: boolean;
  status?: string;
  sellerId?: string;
  categoryId?: string;
}

export function matchingOffers(
  wanted: { title?: unknown; categoryId?: string },
  all: MatchCandidate[],
  myUid: string
): MatchCandidate[] {
  const words = significantWords(
    wanted.title && typeof wanted.title === 'object'
      ? Object.values(wanted.title as Record<string, unknown>).join(' ')
      : wanted.title
  );
  // 0.0.0.31 FIX-WEB-020: need at least 2 significant words to match on —
  // a single-word wanted ad cannot produce a reliable match.
  if (words.size < 2) return [];
  return all.filter((l) => {
    if (l.isWanted) return false;
    if (l.status === 'sold') return false;
    if (l.sellerId === myUid) return false;
    if (l.categoryId !== wanted.categoryId) return false;
    const lw = significantWords(
      l.title && typeof l.title === 'object'
        ? Object.values(l.title as Record<string, unknown>).join(' ')
        : l.title
    );
    // 0.0.0.31 FIX-WEB-020: ≥2 significant shared words (was: any single
    // word — «Symbol 2018» matched «Clio 2019» on the year alone).
    let shared = 0;
    for (const w of lw) if (words.has(w) && ++shared >= 2) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// js/market.js — matchVerifiedStores (verbatim logic, Round 93).
//
// Verified-store cards atop search results (js/home.js 0.0.0.1m, Zak).
// Pure: match verified stores against a search query. Arabic-aware (reuses
// normalizeListingTitle), matches storeName or username, strips a leading @,
// verified-only, capped at `max`.
// Ranking (20 Sep 2026 review, Zak): exact @username first, then exact
// normalized store name, then partial matches — within each tier the
// most-followed store comes first. Exact duplicate verified store names will
// be rejected at admin approval, so the exact-name tier normally holds one store.
export interface MatchableStore {
  storeTier?: string;
  storeName?: string;
  username?: string;
  followerCount?: number;
}

export function matchVerifiedStores<T extends MatchableStore>(
  stores: T[] | null | undefined,
  query: unknown,
  max?: number
): T[] {
  const m = max || 3;
  let q = String(query || '').trim();
  if (q.charAt(0) === '@') q = q.slice(1);
  q = normalizeListingTitle(q);
  if (!q) return [];
  const out: { s: T; tier: number; fc: number }[] = [];
  (stores || []).forEach((s) => {
    if (!s || s.storeTier !== 'verified') return;
    const name = normalizeListingTitle(s.storeName || '');
    const uname = normalizeListingTitle(s.username || '');
    const nameHit = name !== '' && name.indexOf(q) !== -1;
    const unameHit = uname !== '' && uname.indexOf(q) !== -1;
    if (!nameHit && !unameHit) return;
    // 0 = exact username, 1 = exact normalized store name, 2 = partial.
    const tier = uname !== '' && uname === q ? 0 : name !== '' && name === q ? 1 : 2;
    out.push({ s, tier, fc: Number(s.followerCount) || 0 });
  });
  out.sort((a, b) => a.tier - b.tier || b.fc - a.fc);
  return out.slice(0, m).map((e) => e.s);
}
