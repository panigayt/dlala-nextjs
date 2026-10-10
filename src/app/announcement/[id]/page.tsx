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

import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { cacheLife } from 'next/cache';
import {
  fetchAnnouncement,
  annLocalized,
  annSafeLink,
  type Announcement,
} from '@/lib/firestore';
import ShareButton from './ShareButton';

// Trilingual strings — verbatim from js/i18n.{ar,en,fr}.js
const STR = {
  back: { ar: 'رجوع', fr: 'Retour', en: 'Back' },
  announcements: { ar: 'إعلانات الفريق', fr: "Annonces de l'équipe", en: 'Team announcements' },
  notFound: { ar: 'الإعلان غير موجود.', fr: 'Annonce introuvable.', en: 'Announcement not found.' },
  link: { ar: 'زيارة الرابط', fr: 'Visiter le lien', en: 'Visit link' },
};

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


function NotFoundView() {
  return (
    <div className="rounded-xl bg-white p-8 text-center">
      <div className="text-4xl">📢</div>
      <h1 lang="ar" dir="rtl" className="mt-3 text-lg font-semibold text-zinc-800">
        {STR.notFound.ar}
      </h1>
      <p lang="fr" dir="ltr" className="mt-1 text-sm text-zinc-500">
        {STR.notFound.fr}
      </p>
      <p lang="en" dir="ltr" className="mt-1 text-sm text-zinc-500">
        {STR.notFound.en}
      </p>
      <p className="mt-4">
        <Link
          href="/announcements"
          className="inline-block font-semibold text-emerald-700"
          lang="ar"
          dir="rtl"
        >
          ‹ {STR.announcements.ar}
        </Link>
      </p>
    </div>
  );
}

function fmtDate(d: Date | undefined): string {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-DZ', { year: 'numeric', month: 'long', day: 'numeric' });
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

  if (error || !a) {
    return <NotFoundView />;
  }

  const title = annLocalized(a.title) || STR.announcements.ar;
  const body = annLocalized(a.body);
  const date = fmtDate(a.createdAt);
  const link = annSafeLink(a.link);

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex items-center gap-2">
        <Link
          href="/announcements"
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
        >
          <span lang="ar" dir="rtl">
            {STR.back.ar}
          </span>
          <span lang="fr" dir="ltr" className="sr-only">
            {' '}
            / {STR.back.fr}
          </span>
          <span lang="en" dir="ltr" className="sr-only">
            {' '}
            / {STR.back.en}
          </span>
        </Link>
        <ShareButton url={`/announcement/${a.id}`} title={title} />
      </div>
      <Link
        href="/announcements"
        className="mb-3 inline-block text-sm font-semibold text-emerald-700"
        lang="ar"
        dir="rtl"
      >
        ‹ {STR.announcements.ar}
      </Link>
      {date && <div className="text-xs text-zinc-500">{date}</div>}
      <h1 className="mt-2 text-xl font-bold text-zinc-900">{title}</h1>
      {body && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-zinc-800">{body}</p>}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="mt-4 inline-block rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
        >
          <span lang="ar" dir="rtl">
            {STR.link.ar}
          </span>
          <span lang="fr" dir="ltr" className="sr-only">
            {' '}
            / {STR.link.fr}
          </span>
          <span lang="en" dir="ltr" className="sr-only">
            {' '}
            / {STR.link.en}
          </span>
        </a>
      )}
    </article>
  );
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
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Suspense fallback={<DetailSkeleton />}>
          <AnnDetail params={params} />
        </Suspense>
      </main>
    </div>
  );
}
