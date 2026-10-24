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
export const SITE = 'https://www.dzdlala.com';

import { t, type Lang } from './i18n-strings';
import { normalizeCarBrand, normalizePhoneBrand } from './brand-normalize';

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

// Verbatim port of js/listing.js listingBrandName() + R23-1 fix
// (24 Oct 2026): the port only accepted cb*/pb* KEYS, so every listing
// whose answers.brand is a legacy plain spelling ("Renault",
// "Volkswagen", Arabic رونو…) — 1,143 of 1,455 listings at audit time —
// silently lost its JSON-LD brand even though the brand IS honestly
// known. Legacy values now resolve through the SAME normalization the
// search pipeline uses (normalizeCarBrand/normalizePhoneBrand in
// ./brand-normalize — the LEGACY_*_BRAND_MAP single source of truth),
// or by exact match against a BRAND_LATIN display value ("Citroën"
// written in full). A value no map knows still returns '' — a brand is
// never invented.
export function listingBrandName(
  answers: Record<string, unknown> | undefined
): string {
  try {
    const b = answers && (answers as Record<string, unknown>).brand;
    if (!b || typeof b !== 'string') return '';
    if (/Other$/.test(b)) return '';
    let key = '';
    if (/^(cb|pb)[A-Z]/.test(b)) {
      key = b;
    } else {
      key = normalizeCarBrand(b) || normalizePhoneBrand(b);
      if (!key) {
        // Full display spelling stored verbatim (e.g. "Citroën",
        // "Mercedes-Benz"): honestly known, use it directly.
        const v = b.trim().toLowerCase();
        const hit = Object.values(BRAND_LATIN).find(
          (name) => name.toLowerCase() === v
        );
        if (hit) return hit;
        return '';
      }
    }
    if (/Other$/.test(key)) return '';
    const name = BRAND_LATIN[key];
    if (!name || name === key) return '';
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
  // 17 Oct 2026 (SEO audit FIX #14): priceLabel carries fmtPriceText's
  // U+2066…U+2069 LTR isolates (correct for RTL page rendering, but they
  // leak as invisible control characters into <meta name="description">).
  // Metadata must be plain text — strip the isolates before the cap.
  let desc = (
    title + (parts.length ? ' — ' + parts.join(' · ') : '') + '. ' + (o.siteTagline || 'DLALA')
  ).replace(/[\u2066\u2069]/g, '');
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
  /** 17 Oct 2026: true when the listing has at least one REAL product photo
      (not the site icon fallback, not a category placeholder). Google's
      merchant-listing validation rejects non-product images as "image manquant". */
  hasRealImage?: boolean;
}

// Verbatim port of js/seo.js listingJsonLd().
// History: 16 Oct 2026 — when there was no real price (1-DZD negotiable
// convention), this returned null: no Product JSON-LD at all (Google then
// required offers/review/aggregateRating on Product markup, and a fake
// "1 DZD" offers.price would have been a false price).
// 21 Oct 2026 (audit round D1, Zak's fix order): that null took ALL
// structured data off negotiable listings — a large class (7 of the first
// 24 home-feed cards). Zak's standing BW-1 policy is only "NO offers block
// for negotiable listings" — it never required zero JSON-LD. Resolution:
// every listing with a real photo + description serves Product (WITHOUT
// offers when there is no real price — still no fake price) plus a
// BreadcrumbList. Real-priced listings are unchanged (Product + offers),
// now with the same breadcrumb appended.
// Returns the JSON-LD blocks for the page's single <script> tag, or null
// when the listing cannot honestly carry Product markup at all.
export function listingJsonLd(o: ListingJsonLdInput): Record<string, unknown>[] | null {
  const hasRealPrice = typeof o.price === 'number' && isFinite(o.price) && o.price > 1;
  // 17 Oct 2026 (Google Search Console: "image" manquant, critical): Google's
  // merchant-listing validation rejects the site-icon fallback and category
  // placeholders as product images. No real photo → no Product JSON-LD at all.
  // Honest: no fake image, no validation errors, no rich snippet.
  if (!o.hasRealImage) return null;
  // 17 Oct 2026 (Google Search Console: "description" manquant, non-critical):
  // guard against empty descriptions.
  const description = (o.description || '').trim();
  if (!description) return null;
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: o.title,
    description,
  };
  // BW-1 (Zak): the offers block exists ONLY for a real price. Emitting
  // "1 DZD" for a negotiable listing would be a false price.
  if (hasRealPrice) {
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
    // 15 Oct 2026 (Google Search Console critical): Google REQUIRES price
    // inside offers — present here because this branch is real-price only.
    offers.price = o.price;
    if (o.condition === 'new') offers.itemCondition = 'https://schema.org/NewCondition';
    else if (o.condition === 'used') offers.itemCondition = 'https://schema.org/UsedCondition';
    ld.offers = offers;
  }
  if (o.image) ld.image = Array.isArray(o.image) ? o.image : [o.image];
  // 0.0.0.30 (Zak): brand only when honestly known.
  if (o.brand) ld.brand = { '@type': 'Brand', name: o.brand };
  // 0.0.0.30 (Zak): category REMOVED — localized category name was flagged
  // "Valeur non valide"; no honest Google-taxonomy mapping exists.
  // Breadcrumb: same shape as the guide/model pages (price-guide.ts).
  return [ld, breadcrumbLd(o.title, o.url)];
}

// Breadcrumb shared by the listing builders below: home → this page.
// Listing JSON-LD is always Arabic (R54), so the home crumb is Arabic.
function breadcrumbLd(title: string, url: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: title, item: url },
    ],
  };
}

export interface WantedJsonLdInput {
  title: string;
  description: string;
  image?: string | string[] | null;
  brand?: string;
  url: string;
  /** The wanted ad's budget (its stored price field). */
  budget?: number;
}

// R32-1 (24 Oct 2026): wanted listing pages shipped NO JSON-LD at all.
// listingJsonLd() cannot serve them: a wanted ad has no real product
// photo (its image is the wanted placeholder), so the Product gate
// returns null — honestly, since a wanted ad is not a product for
// sale. It is a DEMAND: someone seeking an item. This builder emits
// the schema.org Demand shape — the sought item as itemOffered, the
// budget as a PriceSpecification maxPrice (the sanctioned
// structured-data place for the number; BW-1 still holds — no offers
// block, no fake price, and a budget of 1 DZD, the no-budget
// convention, emits no priceSpecification at all). Photos are carried
// only when the ad has real ones (the caller passes none for the
// placeholder). Same description guard and breadcrumb as listingJsonLd.
export function wantedJsonLd(o: WantedJsonLdInput): Record<string, unknown>[] | null {
  const description = (o.description || '').trim();
  if (!description) return null;
  const itemOffered: Record<string, unknown> = {
    '@type': 'Product',
    name: o.title,
    description,
  };
  if (o.image) itemOffered.image = Array.isArray(o.image) ? o.image : [o.image];
  // 0.0.0.30 (Zak): brand only when honestly known.
  if (o.brand) itemOffered.brand = { '@type': 'Brand', name: o.brand };
  const demand: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Demand',
    name: o.title,
    description,
    url: o.url,
    itemOffered,
  };
  if (typeof o.budget === 'number' && isFinite(o.budget) && o.budget > 1) {
    demand.priceSpecification = {
      '@type': 'PriceSpecification',
      maxPrice: o.budget,
      priceCurrency: 'DZD',
    };
  }
  return [demand, breadcrumbLd(o.title, o.url)];
}

export interface SellerJsonLdInput {
  /** Display name exactly as rendered on the page (store name for
      verified pro stores, else the person's name). */
  name: string;
  url: string;
  /** The seller's real photo/logo (absolute URL); omitted when none. */
  image?: string;
  /** Verified pro store → Store; everyone else → Person. */
  isStore: boolean;
  /** The listings rendered on the page (first page of the grid). */
  listings: { name: string; url: string; image?: string }[];
}

// R32-2 (24 Oct 2026): seller/store pages shipped NO JSON-LD at all.
// This builder emits the seller (Store for verified pro stores,
// Person otherwise) plus an ItemList of exactly the listings the page
// renders — no extra reads, nothing the page doesn't show. Deliberate
// omissions: followerCount (server-maintained field proven unreliable
// in R30-2 — never publish a number we can't stand behind) and any
// aggregateRating (the page shows individual ratings, not an
// aggregate we compute).
export function sellerJsonLd(o: SellerJsonLdInput): Record<string, unknown>[] {
  const seller: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': o.isStore ? 'Store' : 'Person',
    name: o.name,
    url: o.url,
  };
  if (o.image) seller.image = o.image;
  const blocks: Record<string, unknown>[] = [seller];
  if (o.listings.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      numberOfItems: o.listings.length,
      itemListElement: o.listings.map((it, i) => {
        const item: Record<string, unknown> = {
          '@type': 'Product',
          name: it.name,
          url: it.url,
        };
        if (it.image) item.image = it.image;
        return { '@type': 'ListItem', position: i + 1, item };
      }),
    });
  }
  return blocks;
}
