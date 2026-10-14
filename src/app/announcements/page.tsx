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
//
// Round 120: server data shell only — the client shell
// (AnnouncementsClient) owns every user-facing string via the app-wide
// language store. Raw localized maps cross to the client; localization
// follows the UI language (js/announcements.js annLocalized(map, lang)).

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cacheLife } from 'next/cache';
import { fetchAnnouncements, type Announcement } from '@/lib/firestore';
import { t } from '@/lib/i18n-strings';
import { getServerLang } from '@/lib/server-lang';
import AnnouncementsClient, { AnnSkeleton } from './AnnouncementsClient';
import type { AnnListItem } from './AnnList';

// Round 133: <title> follows the reader's language (dlala_lang cookie;
// localStorage is client-only).
// 11 Oct 2026: localized description + OG tags (share button needs previews).
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getServerLang();
  const descs: Record<string, string> = {
    ar: 'الإعلانات الرسمية من فريق دلالة',
    fr: 'Annonces officielles de l\'équipe Dlala',
    en: 'Official announcements from the Dlala team',
  };
  const desc = descs[lang] || descs.ar;
  const title = t('title_announcements', lang);
  return {
    title,
    description: desc,
    alternates: { canonical: 'https://www.dzdlala.com/announcements' },
    openGraph: {
      title,
      description: desc,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description: desc,
    },
  };
}

async function getAnnouncements(): Promise<Announcement[]> {
  'use cache';
  cacheLife({ revalidate: 60 });
  return fetchAnnouncements(50);
}

async function AnnContent() {
  let list: Announcement[] = [];
  let error = false;
  try {
    list = await getAnnouncements();
  } catch {
    error = true;
  }

  const items: AnnListItem[] = list.map((a) => ({
    id: a.id,
    title: a.title ?? '',
    body: a.body ?? '',
    iso: a.createdAt instanceof Date && !isNaN(a.createdAt.getTime()) ? a.createdAt.toISOString() : '',
  }));

  return <AnnouncementsClient items={items} error={error} />;
}

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<AnnSkeleton />}>
      <AnnContent />
    </Suspense>
  );
}
