// Dlala per-listing SEO — verbatim port of ~/workspace/dlala-040/js/seo.js
// (listingSeoText, listingJsonLd) + the helpers js/listing.js
// applyListingSeoHead relies on (listingBrandName, isConditionExempt,
// condLabel, fmtPriceText).
//
// Mirrors:
//   - title:           "<title> — DLALA"
//   - description:     "<title> — <price> · <wilaya> · <cond>. <tagline>"
//                      (160-char cap)
//   - OG/Twitter tags: og:type=product, site_name=DLALA, summary_large_image
//   - JSON-LD:         schema.org Product/Offer (DZD, availability by status,
//                      MerchantReturnNotPermitted, itemCondition new/used,
//                      brand only when honestly known, NO category field —
//                      0.0.0.30 Zak: Google flagged localized category as
//                      "Valeur non valide").
// Server-safe (pure functions, no DOM). The page renders the JSON-LD
// <script> itself; Next.js generateMetadata() emits title/meta/OG/Twitter.
//
// NOTE: crawlers that don't run JS (WhatsApp/FB/Twitter) need a server
// renderer for link previews — same honest limit as legacy.

// Canonical site base (production domain). Must match the BASE in
// src/app/sitemap.ts.
export const SITE = 'https://dzdlala.com';

import { t, type Lang } from './i18n-strings';

// Brand keys (cb*/pb*) -> Latin proper-noun label. Copied verbatim from
// js/i18n.{ar,fr,en}.js (identical in all three): brand only when honestly
// known (0.0.0.30 Zak). Keys ending in "Other" resolve to Arabic "أخرى" in
// i18n and are therefore excluded by listingBrandName() below.
export const BRAND_LATIN: Record<string, string> = {
  pbApple: 'Apple',
  pbSamsung: 'Samsung',
  pbHonor: 'Honor',
  pbHuawei: 'Huawei',
  pbXiaomi: 'Xiaomi',
  pbOppo: 'Oppo',
  pbRealme: 'Realme',
  pbInfinix: 'Infinix',
  pbTecno: 'Tecno',
  cbRenault: 'Renault',
  cbDacia: 'Dacia',
  cbPeugeot: 'Peugeot',
  cbCitroen: 'Citroën',
  cbFiat: 'Fiat',
  cbVolkswagen: 'Volkswagen',
  cbHyundai: 'Hyundai',
  cbKia: 'Kia',
  cbToyota: 'Toyota',
  cbNissan: 'Nissan',
  cbSkoda: 'Skoda',
  cbSeat: 'Seat',
  cbOpel: 'Opel',
  cbSuzuki: 'Suzuki',
  cbAudi: 'Audi',
  cbBmw: 'BMW',
  cbMercedes: 'Mercedes-Benz',
  cbChery: 'Chery',
  cbGeely: 'Geely',
  cbByd: 'BYD',
};

// Brand key (pb*/cb*) -> Latin proper-noun label for facet option lists.
// Keys ending in "Other" are localized (AR أخرى / FR Autres / EN Other).
export function brandLatinName(key: string, lang: Lang = 'ar'): string {
  if (/Other$/.test(key)) return lang === 'fr' ? 'Autres' : lang === 'en' ? 'Other' : 'أخرى';
  return BRAND_LATIN[key] || key;
}

// Verbatim port of js/listing.js listingBrandName().
export function listingBrandName(
  answers: Record<string, unknown> | undefined
): string {
  try {
    const b = answers && (answers as Record<string, unknown>).brand;
    if (!b || typeof b !== 'string') return '';
    if (/Other$/.test(b)) return '';
    if (!/^(cb|pb)[A-Z]/.test(b)) return '';
    const name = BRAND_LATIN[b];
    if (!name || name === b) return '';
    // Allow Latin accented chars (Citroën) — 14 Oct 2026: 'ë' was rejected,
    // dropping brand from JSON-LD on every Citroen listing.
    if (!/^[A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ .&'\-]*$/.test(name)) return '';
    return name;
  } catch {
    return '';
  }
}

// Verbatim port of js/app.js isConditionExempt() (C-R24-1, Zak approved).
// Exempt: services/jobs, and realestate land (reLand answers).
export function isConditionExempt(
  categoryId: string | undefined,
  answers: Record<string, unknown> | undefined
): boolean {
  const cat = categoryId || '';
  if (cat === 'services' || cat === 'jobs') return true;
  if (
    cat === 'realestate' &&
    answers &&
    (answers as Record<string, unknown>).propertyType === 'reLand'
  )
    return true;
  return false;
}

// Round 133: lang-aware condition label for localized SEO titles.
// Same semantics as condLabelAr; labels from condNew/condGood/condUsed
// (verbatim js/i18n.{ar,fr,en}.js).
export function condLabel(c: string | undefined, lang: Lang = 'ar'): string {
  return c === 'new'
    ? t('condNew', lang)
    : c === 'good'
      ? t('condGood', lang)
      : c === 'used'
        ? t('condUsed', lang)
        : '';
}

// Verbatim port of js/app.js fmtPriceText() — LTR-isolated plain-text price
// (U+2066…U+2069) so the digit run never reorders in RTL meta text.
// Round 133: lang-aware currency via t('priceDZD') (legacy used t() too).
export function fmtPriceText(n: number | undefined | null, lang: Lang = 'ar'): string {
  if (n == null) return '';
  const v = Number(n);
  if (!isFinite(v) || v < 0) return '—';
  return '⁦' + v.toLocaleString('en-US') + ' ' + t('priceDZD', lang) + '⁩';
}

export interface ListingSeoInput {
  title: string;
  priceLabel: string;
  wilayaLabel: string;
  condLabel: string;
  siteTagline?: string;
}

// Verbatim port of js/seo.js listingSeoText().
export function listingSeoText(o: ListingSeoInput): {
  title: string;
  description: string;
} {
  const title = (o.title || '').trim();
  const parts: string[] = [];
  if (o.priceLabel) parts.push(o.priceLabel);
  if (o.wilayaLabel) parts.push(o.wilayaLabel);
  if (o.condLabel) parts.push(o.condLabel);
  let desc =
    title + (parts.length ? ' — ' + parts.join(' · ') : '') + '. ' + (o.siteTagline || 'DLALA');
  if (desc.length > 160) desc = desc.slice(0, 157) + '…';
  return { title: title ? title + ' — DLALA' : 'DLALA', description: desc };
}

export interface ListingJsonLdInput {
  title: string;
  description: string;
  image?: string | string[] | null;
  brand?: string;
  url: string;
  price?: number;
  condition?: string;
  status?: string;
}

// Verbatim port of js/seo.js listingJsonLd().
export function listingJsonLd(o: ListingJsonLdInput): Record<string, unknown> {
  const offers: Record<string, unknown> = {
    '@type': 'Offer',
    url: o.url,
    priceCurrency: 'DZD',
    // 0.0.0.31 FIX-WEB-047: a sold listing is OutOfStock — never InStock.
    availability:
      o.status === 'sold'
        ? 'https://schema.org/OutOfStock'
        : o.status === 'negotiating'
          ? 'https://schema.org/LimitedAvailability'
          : 'https://schema.org/InStock',
    // 0.0.0.30 (Zak): C2C classifieds — sales between individuals are
    // final, no returns. Clears Google's "hasMerchantReturnPolicy
    // manquant" merchant-listing warning.
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      // 3 Oct 2026: "applicableCountry" manquant (non-critical).
      // Dlala is Algeria-only C2C.
      applicableCountry: 'DZ',
      returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    },
  };
  if (typeof o.price === 'number' && isFinite(o.price)) offers.price = o.price;
  if (o.condition === 'new') offers.itemCondition = 'https://schema.org/NewCondition';
  else if (o.condition === 'used') offers.itemCondition = 'https://schema.org/UsedCondition';
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: o.title,
    description: o.description,
    offers: offers,
  };
  if (o.image) ld.image = Array.isArray(o.image) ? o.image : [o.image];
  // 0.0.0.30 (Zak): brand only when honestly known.
  if (o.brand) ld.brand = { '@type': 'Brand', name: o.brand };
  // 0.0.0.30 (Zak): category REMOVED — localized category name was flagged
  // "Valeur non valide"; no honest Google-taxonomy mapping exists.
  return ld;
}
