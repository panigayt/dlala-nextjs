// js/market.js — matchingOffers (verbatim logic, Round 86).
//
// Wanted ads (مطلوب): reverse-matched regular offers — same category,
// ≥2 significant title words in common, not mine, not sold. Rendered on
// the wanted listing page under the «عروض مطابقة لطلبك» heading
// (js/listing.js loadMatches, isWanted branch).

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
