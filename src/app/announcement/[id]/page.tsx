// Announcement detail page — Server-Side Rendered.
//
// Port of ~/workspace/dlala-040/announcement.html + js/announcement.js:
//   - Shareable per-announcement page: date, localized title, full body,
//     optional external link, share button (Web Share API with a
//     copy-link fallback).
//   - Public read-only: single-doc get; renders ONLY when active === true
//     (the list rule only ever exposes active docs). Otherwise the
//     trilingual announcementNotFound view.
//   - Clean URL /announcement/[id] instead of /announcement.html?id=.
//   - ISR 60s (same as the other Next.js data pages).
//
// Round 120: server data shell only — the client shell (AnnouncementDetail)
// owns every user-facing string via the app-wide language store, and
// title/body/date follow the UI language (js/announcement.js onLangChange
// parity). generateMetadata keeps the server-side Arabic-first title
// (annLocalized default 'ar' = legacy annLocalized(map) fallback).

import type { Metadata } from 'next';
import { Suspense, cache } from 'react';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import { fetchAnnouncement, annLocalized, type Announcement } from '@/lib/firestore';
import { t } from '@/lib/i18n-strings';
import { getServerLang } from '@/lib/server-lang';
import AnnouncementDetail, { type AnnouncementDetailData } from './AnnouncementDetail';

// Trilingual strings — verbatim from js/i18n.{ar,en,fr}.js (Round 120:
// now owned by src/lib/i18n.ts; the skeleton keeps t('loading') via the
// client shell — no local dict here).
async function _getAnnouncement(id: string): Promise<Announcement | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const a = await fetchAnnouncement(id);
  // Render only active announcements — legacy js/announcement.js rule.
  if (!a || a.active !== true) return null;
  return a;
}

// Round 12 (12 Oct 2026): React cache() dedupes the existence check across
// generateMetadata + the page body within one request — one Firestore read.
const getAnnouncement = cache(_getAnnouncement);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // 17 Oct 2026 (audit H2 — root-cause fix): metadata is STATIC Arabic —
  // no dlala_lang cookie read. Awaiting cookies() in generateMetadata
  // deferred the metadata segment past the initial <head> flush, so Next
  // streamed <title>/<meta>/OG into <body>. The reader's localized tab
  // title (Round 133) is set client-side by AnnouncementDetail instead.
  const lang = 'ar' as const;
  const suffix = 'دلالة';
  let a: Announcement | null = null;
  let fetchFailed = false;
  try {
    a = await getAnnouncement(id);
  } catch {
    // Transient fetch failure — fall through to the noindex fallback below
    // (the page renders the error UI itself). A 404 must only be served for
    // genuinely missing announcements, never for a failed fetch.
    fetchFailed = true;
  }
  // Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
  // proxy (src/proxy.ts + src/proxy-404.ts) — it runs the Firestore
  // existence check BEFORE any rendering/streaming starts (404/403 on
  // documents/announcements/{id}, or active !== true → real 404 status;
  // transient check failures fail open to this page). The earlier
  // Round-12 plan of notFound() here kept HTTP 200 under
  // cacheComponents:true PPR (verified via curl 12 Oct 2026), so it is
  // retained only as a harmless fallback for the no-proxy case: the
  // dynamic metadata also streams after the 200 headers are sent, so a
  // notFound() here cannot set the 404 status either. The fetch is
  // already on the critical path (SEO metadata needs the announcement),
  // so no extra latency is added for valid docs.
  if ((!a || a.active !== true) && !fetchFailed) notFound();
  // 11 Oct 2026: noindex on inactive/missing as belt-and-braces (the
  // not-found boundary also injects noindex); reached only on fetch
  // failure, where the page keeps its error UI at HTTP 200.
  if (!a || a.active !== true) {
    return {
      title: t('title_announcement', lang),
      robots: { index: false, follow: false },
    };
  }
  try {
    const title = annLocalized(a.title, lang);
    const fullTitle = title ? `${title} — ${suffix}` : t('title_announcement', lang);
    // 11 Oct 2026: description + OG tags (share button needs previews).
    const desc = annLocalized(a.body, lang).slice(0, 160);
    return {
      title: fullTitle,
      description: desc || undefined,
      alternates: { canonical: 'https://www.dzdlala.com/announcement/' + encodeURIComponent(id) },
      openGraph: {
        title: fullTitle,
        description: desc || undefined,
        type: 'article',
      },
      twitter: {
        card: 'summary',
        title: fullTitle,
        description: desc || undefined,
      },
    };
  } catch {
    return { title: t('title_announcement', lang) };
  }
}

// Round 11 (12 Oct 2026): transient-error UI — port of the Round 9
// listing TransientErrorView (src/app/listing/[id]/page.tsx). Trilingual
// static messaging (AR/FR/EN all rendered, same wording pattern) plus a
// native <a> retry link: a full document reload re-runs the server
// component and retries the Firestore fetch. Genuinely missing
// announcements (null) never reach this — they get notFound() above.
async function TransientErrorView({ id }: { id: string }) {
  const lang = await getServerLang();
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="rounded-xl bg-white p-8 text-center">
        <div className="text-4xl">📢</div>
        <h1 className="mt-3 text-lg font-semibold text-zinc-800" lang="ar" dir="rtl">تعذّر تحميل الإعلان</h1>
        <p className="mt-2 text-zinc-600" lang="ar" dir="rtl">
          حدث خطأ مؤقت أثناء تحميل هذا الإعلان. قد يكون الإعلان موجوداً — حاول مرة أخرى.
        </p>
        <p className="mt-1 text-zinc-600" lang="fr">Impossible de charger cette annonce pour le moment. Veuillez réessayer.</p>
        <p className="mt-1 text-zinc-600" lang="en">This announcement could not be loaded right now. Please try again.</p>
        <div className="mt-6">
          <a
            href={`/announcement/${encodeURIComponent(id)}`}
            className="inline-block rounded-lg bg-emerald-700 px-6 py-3 font-medium text-white"
          >
            {t('retry', lang)}
          </a>
        </div>
      </div>
    </div>
  );
}

async function AnnDetail({ ann }: { ann: Announcement | null }) {
  // Round 12: the existence check ran in the page body (ONE read shared via
  // the React-cache-deduped getAnnouncement) — null here is unreachable
  // (the page body already called notFound()); transient failures never
  // reach this component (the page body renders TransientErrorView at
  // HTTP 200 instead).
  const data: AnnouncementDetailData | null = ann
    ? {
        id: ann.id,
        title: ann.title,
        body: ann.body,
        iso:
          ann.createdAt instanceof Date && !isNaN(ann.createdAt.getTime())
            ? ann.createdAt.toISOString()
            : '',
        link: typeof ann.link === 'string' ? ann.link : '',
      }
    : null;

  return <AnnouncementDetail ann={data} error={false} />;
}

function DetailSkeleton() {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="h-5 w-1/4 animate-pulse rounded bg-zinc-200" />
      <div className="mt-3 h-7 w-2/3 animate-pulse rounded bg-zinc-200" />
      <div className="mt-3 h-4 w-full animate-pulse rounded bg-zinc-200" />
      <div className="mt-2 h-4 w-full animate-pulse rounded bg-zinc-200" />
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-zinc-200" />
    </div>
  );
}

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Round 14 (12 Oct 2026): the REAL HTTP 404 now comes from the Edge
  // proxy (src/proxy.ts + src/proxy-404.ts), which checks Firestore
  // BEFORE rendering/streaming starts. The earlier Round-12 approach of
  // notFound() at this point kept HTTP 200: with cacheComponents:true
  // the page-body await is postponed (x-nextjs-postponed: 1), so the 200
  // headers were sent before notFound() threw (verified via curl on a
  // local production build 12 Oct 2026). Retained only as a harmless
  // fallback for the no-proxy case.
  let a: Announcement | null = null;
  let error = false;
  try {
    a = await getAnnouncement(id);
  } catch {
    error = true;
  }

  // Genuinely missing/inactive (null) → notFound() boundary UI as a
  // harmless fallback; the real HTTP 404 already came from the Edge
  // proxy for these docs (see above). A THROWN fetch is a transient
  // failure → HTTP 200 + retry UI (Round 11 TransientErrorView),
  // never a 404.
  if (!a && !error) notFound();

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50">
        <main id="main-content" className="mx-auto max-w-3xl px-4 py-6">
          <TransientErrorView id={id} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6">
        <Suspense fallback={<DetailSkeleton />}>
          <AnnDetail ann={a} />
        </Suspense>
      </main>
    </div>
  );
}
