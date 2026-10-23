// Brand facet keys + legacy free-text brand normalization — extracted
// verbatim from src/lib/firestore.ts (R23-1 fix, 24 Oct 2026) so PURE
// consumers (src/lib/seo.ts listingBrandName, and client components via
// seo.ts) can share the search pipeline's exact brand unification
// WITHOUT importing the server Firestore client. firestore.ts imports
// and re-exports every name below; the maps and normalizers here are
// the single source of truth for search matching AND JSON-LD brand.

// --- Category facet filters (phones: OS+brand; cars: brand+fuel+gear+year+mileage) ---
// Verbatim port of js/home.js facet logic (0.0.0.43).

export const FACET_PHONE_BRANDS = [
  'pbApple', 'pbSamsung', 'pbHonor', 'pbHuawei', 'pbXiaomi',
  'pbOppo', 'pbRealme', 'pbInfinix', 'pbTecno', 'pbOther',
];

export const FACET_CAR_BRANDS = [
  'cbRenault', 'cbDacia', 'cbPeugeot', 'cbCitroen', 'cbFiat',
  'cbVolkswagen', 'cbHyundai', 'cbKia', 'cbToyota', 'cbNissan',
  'cbSkoda', 'cbSeat', 'cbOpel', 'cbSuzuki', 'cbAudi', 'cbBmw',
  'cbMercedes', 'cbChery', 'cbGeely', 'cbByd', 'cbOther',
];

// 0.0.0.1l (Zak): brand options follow the selected OS.
export function facetPhoneBrandsForOs(os: string): string[] {
  if (os === 'osIos') return ['pbApple'];
  if (os === 'osAndroid') return FACET_PHONE_BRANDS.filter((b) => b !== 'pbApple');
  return FACET_PHONE_BRANDS;
}

// 0.0.0.1z: legacy free-text car brands → cb keys. READ-ONLY normalization:
// unknown values return '' (no guessing) so a brand-filtered search simply
// skips listings it cannot classify instead of showing wrong results.
export const LEGACY_CAR_BRAND_MAP: Record<string, string> = {
  renault: 'cbRenault', dacia: 'cbDacia', peugeot: 'cbPeugeot',
  citroen: 'cbCitroen', fiat: 'cbFiat', volkswagen: 'cbVolkswagen', vw: 'cbVolkswagen',
  hyundai: 'cbHyundai', kia: 'cbKia', toyota: 'cbToyota', nissan: 'cbNissan',
  skoda: 'cbSkoda', seat: 'cbSeat', opel: 'cbOpel', suzuki: 'cbSuzuki',
  audi: 'cbAudi', bmw: 'cbBmw', mercedes: 'cbMercedes', mercedesbenz: 'cbMercedes',
  chery: 'cbChery', geely: 'cbGeely', byd: 'cbByd',
  'رونو': 'cbRenault', 'رينو': 'cbRenault',
  'داسيا': 'cbDacia', 'داشيا': 'cbDacia',
  'بيجو': 'cbPeugeot', 'بوجو': 'cbPeugeot',
  'سيتروين': 'cbCitroen', 'ستروين': 'cbCitroen',
  'فيات': 'cbFiat',
  'فولكسفاغن': 'cbVolkswagen', 'فولكسفاجن': 'cbVolkswagen', 'فولكسواجن': 'cbVolkswagen',
  'هيونداي': 'cbHyundai', 'هونداي': 'cbHyundai',
  'كيا': 'cbKia',
  'تويوتا': 'cbToyota', 'طويوطا': 'cbToyota',
  'نيسان': 'cbNissan',
  'سكودا': 'cbSkoda', 'شكودا': 'cbSkoda',
  'سيات': 'cbSeat',
  'اوبل': 'cbOpel',
  'سوزوكي': 'cbSuzuki',
  'اودي': 'cbAudi',
  'بيامدبليو': 'cbBmw',
  'مرسيدس': 'cbMercedes', 'مرسيدسبنز': 'cbMercedes',
  'شيري': 'cbChery',
  'جيلي': 'cbGeely',
  'بيوايدي': 'cbByd',
};

export function normalizeCarBrand(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (s.startsWith('cb')) return FACET_CAR_BRANDS.includes(s) ? s : '';
  const latin = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (latin && LEGACY_CAR_BRAND_MAP[latin]) return LEGACY_CAR_BRAND_MAP[latin];
  const ar = s.replace(/[ً-ٖ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, '');
  if (ar && LEGACY_CAR_BRAND_MAP[ar]) return LEGACY_CAR_BRAND_MAP[ar];
  return '';
}

// AZ-1 (18 Oct 2026): phone brand mapping, mirroring the car one above.
// Phone answers.brand is stored as pb* keys (qPhoneBrand → 'brand'); the
// facet select feeds exact keys, but free-text search (q=سامسونج, q=samsung)
// had no map at all and silently returned zero. READ-ONLY normalization:
// unknown values return '' (no guessing). Arabic keys are written in
// alef-normalized form — the same normalization below folds أ/إ/آ→ا, so
// آيفون/أوبو/إنفينيكس all match their single map entry.
export const LEGACY_PHONE_BRAND_MAP: Record<string, string> = {
  samsung: 'pbSamsung', apple: 'pbApple', iphone: 'pbApple',
  xiaomi: 'pbXiaomi', huawei: 'pbHuawei', oppo: 'pbOppo', realme: 'pbRealme',
  honor: 'pbHonor', infinix: 'pbInfinix', tecno: 'pbTecno',
  'سامسونج': 'pbSamsung',
  'ابل': 'pbApple', 'ايفون': 'pbApple',
  'شاومي': 'pbXiaomi',
  'هواوي': 'pbHuawei',
  'اوبو': 'pbOppo',
  'ريلمي': 'pbRealme',
  'هونر': 'pbHonor',
  'انفينيكس': 'pbInfinix',
  'تكنو': 'pbTecno',
};

export function normalizePhoneBrand(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (s.startsWith('pb')) return FACET_PHONE_BRANDS.includes(s) ? s : '';
  const latin = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (latin && LEGACY_PHONE_BRAND_MAP[latin]) return LEGACY_PHONE_BRAND_MAP[latin];
  const ar = s.replace(/[ً-ٖ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, '');
  if (ar && LEGACY_PHONE_BRAND_MAP[ar]) return LEGACY_PHONE_BRAND_MAP[ar];
  return '';
}
