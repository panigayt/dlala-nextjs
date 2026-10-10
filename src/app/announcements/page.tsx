// Team announcements — Server-Side Rendered list.
//
// Port of ~/workspace/dlala-040/announcements.html + js/announcements.js:
//   - Public read-only page: renders the official announcements published
//     from the app's admin panel (Firestore collection `announcements`).
//   - Query keeps the mandatory where('active','==',true) filter (rules v101).
//   - Order: createdAt desc (client-side sort fallback if the composite
//     index is missing — same as legacy annFetch).
//   - Cards are clickable and open the full article at /announcement/[id].
//   - ISR 60s (same as the other Next.js data pages).

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import {
  fetchAnnouncements,
  annLocalized,
  annExcerpt,
  type Announcement,
} from '@/lib/firestore';
import AnnList, { type AnnListItem } from './AnnList';

export const metadata: Metadata = {
  title: 'إعلانات الفريق — دلالة',
  description: 'الإعلانات الرسمية من فريق دلالة',
};

// Trilingual heading strings — verbatim from js/i18n.{ar,en,fr}.js
const HEADING = {
  ar: 'إعلانات الفريق',
  fr: "Annonces de l'équipe",
  en: 'Team announcements',
};
const EMPTY = {
  ar: 'لا توجد إعلانات رسمية حالياً',
  fr: 'Aucune annonce officielle pour le moment',
  en: 'No official announcements right now',
};
const LOADING = 'جارٍ التحميل...';

async function getAnnouncements(): Promise<Announcement[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchAnnouncements(50);
}


function fmtDate(d: Date | undefined): { date: string; iso: string } {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return { date: '', iso: '' };
  return {
    date: d.toLocaleDateString('ar-DZ', { year: 'numeric', month: 'long', day: 'numeric' }),
    iso: d.toISOString(),
  };
}

async function AnnContent() {
  let list: Announcement[] = [];
  let error = false;
  try {
    list = await getAnnouncements();
  } catch {
    error = true;
  }

  if (error) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-zinc-600">
        <p lang="ar" dir="rtl">
          تعذّر تحميل الإعلانات — حاول مجدداً لاحقاً.
        </p>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center">
        <div className="text-4xl">📢</div>
        <p lang="ar" dir="rtl" className="mt-3 text-zinc-600">
          {EMPTY.ar}
        </p>
        <p lang="fr" dir="ltr" className="mt-1 text-sm text-zinc-500">
          {EMPTY.fr}
        </p>
        <p lang="en" dir="ltr" className="mt-1 text-sm text-zinc-500">
          {EMPTY.en}
        </p>
      </div>
    );
  }

  const items: AnnListItem[] = list.map((a) => {
    const title = annLocalized(a.title);
    const body = annLocalized(a.body);
    const { date, iso } = fmtDate(a.createdAt);
    return {
      id: a.id,
      title: title || HEADING.ar,
      excerpt: annExcerpt(body),
      body,
      date,
      iso,
    };
  });

  return <AnnList items={items} />;
}

function AnnSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl bg-white p-4 shadow-sm">
          <div className="h-5 w-2/3 animate-pulse rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-1/4 animate-pulse rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-full animate-pulse rounded bg-zinc-200" />
        </div>
      ))}
      <p className="sr-only">{LOADING}</p>
    </div>
  );
}

export default function AnnouncementsPage() {
  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 lang="ar" dir="rtl" className="mb-1 text-xl font-bold text-zinc-900">
          {HEADING.ar}
        </h1>
        <p lang="fr" dir="ltr" className="text-sm text-zinc-500">
          {HEADING.fr}
        </p>
        <p lang="en" dir="ltr" className="mb-4 text-sm text-zinc-500">
          {HEADING.en}
        </p>
        <Suspense fallback={<AnnSkeleton />}>
          <AnnContent />
        </Suspense>
      </main>
    </div>
  );
}
