// Round 14 (12 Oct 2026) — edge-safe helpers for the proxy-based REAL 404s.
//
// Zak ordered "نفذ 404 حقيقي": notFound() in page body / generateMetadata
// keeps HTTP 200 under cacheComponents PPR streaming (verified 12 Oct
// 2026), so the existence check moved to the Edge proxy (src/proxy.ts),
// which runs BEFORE any rendering/streaming starts and can therefore
// return a genuine HTTP 404 status.
//
// This module is imported by src/proxy.ts and must stay EDGE-SAFE:
// pure static string + fetch only — NO React/JSX, NO firebase libs,
// NO imports from src/lib/*.
//
// SYNC NOTES (keep these in step):
//  - FIREBASE_API_KEY / FIRESTORE_REST_BASE literals must match
//    src/lib/firestore.ts (both are public: the key ships in the client
//    bundle and the base URL is the public Firestore REST endpoint).
//  - TRILINGUAL_404_HTML must visually mirror src/app/not-found.tsx
//    (emerald #0b6b4f theme, "D" mark, 404 heading, exact AR/FR/EN copy,
//    three home links). If not-found.tsx copy changes, update this HTML
//    too — and vice versa (see the comment at the top of not-found.tsx).

// Round 16 T6: env-first (deploy source of truth). Fallback = production
// key from dlala-040/js/config.js (0.0.0.39). Keep in sync with src/lib/firestore.ts.
export const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCcW4X5IvCTi5ujyaBzQl7aJVeYd-A5mcg';

export const FIRESTORE_REST_BASE =
  'https://firestore.googleapis.com/v1/projects/dlala-85cea/databases/(default)/documents';

// Keep in sync with src/lib/firestore.ts fetchListing():
// trailing ".html" (legacy SEO URLs) is stripped before the doc lookup.
export function stripHtmlSuffix(id: string): string {
  return id.replace(/\.html$/i, '');
}

// Outcome of the Firestore REST existence check.
//  - 'missing': 404 or 403 from the REST API (403 = the doc exists but the
//    anonymous REST key can't read it — e.g. sold/hidden listings; the
//    page treats it exactly like missing, same as fetchListing in
//    src/lib/firestore.ts).
//  - 'exists': 200 (and, for announcements, fields.active.booleanValue
//    === true).
//  - 'check-failed': network error, timeout, throw, or 5xx — TRANSIENT.
//    The proxy must FAIL OPEN here (NextResponse.next()); the page's own
//    transient-error UI handles it at HTTP 200. Never 404 on a transient.
export type DocCheck = 'missing' | 'exists' | 'check-failed';

const CHECK_TIMEOUT_MS = 4000; // fail fast, fail open

export async function checkDocExists(
  collection: 'listings' | 'users' | 'announcements',
  docId: string,
  requireActive = false,
): Promise<DocCheck> {
  const url =
    `${FIRESTORE_REST_BASE}/${collection}/${encodeURIComponent(docId)}` +
    `?key=${encodeURIComponent(FIREBASE_API_KEY)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (res.status === 404 || res.status === 403) return 'missing';
    if (!res.ok) return 'check-failed'; // 5xx/429/etc → transient, fail open
    if (requireActive) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return 'check-failed'; // unreadable body → don't decide, fail open
      }
      const active =
        (body as { fields?: { active?: { booleanValue?: boolean } } })?.fields?.active
          ?.booleanValue;
      return active === true ? 'exists' : 'missing';
    }
    return 'exists';
  } catch {
    // network error / timeout / AbortSignal → transient, fail open
    return 'check-failed';
  }
}

// R27-3 follow-up (24 Oct 2026): the owner-recovery styles, shared by the
// static listing 404 (localized404Html) and the proxy's injection into the
// re-emitted /fr|en rendered page (src/proxy.ts). Keep in one place —
// the script (public/owner-404-recovery.js) only sets classNames.
export const OWNER_RECOVERY_CSS = `.dlala-owner-hint{font-size:15px;color:#52525b;margin-top:22px}
.dlala-owner-panel{margin-top:22px;border:2px solid #0b6b4f;border-radius:12px;padding:16px;text-align:start}
.dlala-owner-note{font-size:14px;color:#0b6b4f;font-weight:700;margin:0 0 8px}
.dlala-owner-title{font-size:18px;color:#18181b;font-weight:700;margin:0 0 6px}
.dlala-owner-price{font-size:17px;color:#0b6b4f;font-weight:800;margin:0 0 10px}
.dlala-owner-sold{display:inline-block;background:#dc2626;color:#fff;border-radius:8px;padding:4px 12px;font-size:14px;font-weight:700;margin:0 0 12px}
a.dlala-owner-manage{display:inline-block;background:#0b6b4f;color:#fff;border-radius:12px;padding:12px 32px;font-size:16px;text-decoration:none}`;

// R15b BC-1 (18 Oct 2026): locale-aware 404. /fr/* and /en/* URLs get
// the French/English variant (lang, dir, title, message order) instead
// of always Arabic. The trilingual copy is preserved; the matching
// language is listed first and gets the primary (solid) button.
// R27-3 (24 Oct 2026): listing 404s carry the owner-recovery mount +
// script (public/owner-404-recovery.js). The script tag is emitted ONLY
// for listing 404s — every other 404 keeps byte-identical output — and
// the script itself re-gates on the /listing/<id> pathname, so even a
// misrouted emit cannot run it elsewhere.
export function localized404Html(
  locale: 'ar' | 'fr' | 'en',
  opts?: { listingId?: string }
): string {
  const isAr = locale === 'ar';
  const htmlLang = locale;
  const dir = isAr ? 'rtl' : 'ltr';
  const title =
    locale === 'fr'
      ? 'Page non trouvée | Dlala'
      : locale === 'en'
        ? 'Page not found | Dlala'
        : 'صفحة غير موجودة | دلالة';

  const msgs = {
    ar: { text: 'عذراً، هذه الصفحة غير موجودة.', cta: 'العودة إلى الرئيسية', home: '/' },
    fr: { text: "Désolé, cette page n'existe pas.", cta: "Retour à l'accueil", home: '/fr/' },
    en: { text: 'Sorry, this page does not exist.', cta: 'Back to home', home: '/en/' },
  };
  const order: ('ar' | 'fr' | 'en')[] =
    locale === 'fr' ? ['fr', 'ar', 'en'] : locale === 'en' ? ['en', 'ar', 'fr'] : ['ar', 'fr', 'en'];

  const paragraphs = order
    .map(
      (l) =>
        `<p lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">${msgs[l].text}</p>`
    )
    .join('\n');
  const links = order
    .map((l, i) =>
      i === 0
        ? `<a class="solid" href="${msgs[l].home}" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">${msgs[l].cta}</a>`
        : `<a class="ghost" href="${msgs[l].home}" lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">${msgs[l].cta}</a>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
body{background:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0}
main{max-width:36rem;margin:0 auto;padding:10vh 1.25rem;text-align:center}
.mark{margin:0 auto 18px;display:flex;align-items:center;justify-content:center;height:84px;width:84px;border-radius:22px;background:#0b6b4f;color:#fff;font-size:52px;font-weight:800}
h1{margin:0 0 1rem;color:#0b6b4f;font-size:64px;font-weight:700}
p{font-size:18px;color:#52525b;margin:0 0 10px}
nav{margin-top:26px;display:flex;flex-direction:column;gap:10px}
a{display:block;border-radius:12px;padding:12px 32px;font-size:17px;text-decoration:none}
a.solid{background:#0b6b4f;color:#fff}
a.ghost{background:#fff;color:#0b6b4f;border:2px solid #0b6b4f}${opts?.listingId ? `
${OWNER_RECOVERY_CSS}` : ''}
</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true">D</div>
<h1>404</h1>
${paragraphs}
<nav aria-label="التنقل الرئيسي / Navigation principale / Main navigation">
${links}
</nav>${opts?.listingId ? `
<div id="dlala-owner-recovery"></div>
<script src="/owner-404-recovery.js" defer></script>` : ''}
</main>
</body>
</html>
`;
}

// Static 404 page mirroring src/app/not-found.tsx (no JS, no Tailwind —
// the proxy returns raw HTML). Same emerald theme, same trilingual copy,
// plus noindex so crawlers never index the 404 body.
// (Kept for backward compat; new code should use localized404Html('ar').)
export const TRILINGUAL_404_HTML = localized404Html('ar');
