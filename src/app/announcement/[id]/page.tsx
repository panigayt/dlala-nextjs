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
import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import { fetchAnnouncement, annLocalized, type Announcement } from '@/lib/firestore';
import AnnouncementDetail, { type AnnouncementDetailData } from './AnnouncementDetail';

// Trilingual strings — verbatim from js/i18n.{ar,en,fr}.js (Round 120:
// now owned by src/lib/i18n.ts; the skeleton keeps t('loading') via the
// client shell — no local dict here).
async function getAnnouncement(id: string): Promise<Announcement | null> {
  'use cache';
  cacheLife({ revalidate: 60 });
  const a = await fetchAnnouncement(id);
  // Render only active announcements — legacy js/announcement.js rule.
  if (!a || a.active !== true) return null;
  return a;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const a = await getAnnouncement(id);
    const title = a ? annLocalized(a.title) : '';
    return { title: title ? `${title} — دلالة` : 'إعلان — دلالة' };
  } catch {
    return { title: 'إعلان — دلالة' };
  }
}

async function AnnDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let a: Announcement | null = null;
  let error = false;
  try {
    a = await getAnnouncement(id);
  } catch {
    error = true;
  }

  const data: AnnouncementDetailData | null = a
    ? {
        id: a.id,
        title: a.title,
        body: a.body,
        iso:
          a.createdAt instanceof Date && !isNaN(a.createdAt.getTime())
            ? a.createdAt.toISOString()
            : '',
        link: typeof a.link === 'string' ? a.link : '',
      }
    : null;

  return <AnnouncementDetail ann={data} error={error} />;
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

export default function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Suspense fallback={<DetailSkeleton />}>
          <AnnDetail params={params} />
        </Suspense>
      </main>
    </div>
  );
}
