// Announcement detail — client shell.
//
// Round 120: the server page fetches the doc; everything the user READS
// (not-found view, back links, date, share, external-link label, dir) comes
// from the app-wide language store (useLang). Title/body/date follow the UI
// language (js/announcement.js onLangChange parity — no refetch needed).

'use client';

import Link from 'next/link';
import { useLang, type Lang } from '@/lib/i18n';
import { annLocalized, annSafeLink } from '@/lib/firestore';
import ShareButton from './ShareButton';

export interface AnnouncementDetailData {
  id: string;
  title?: string | Record<string, string>;
  body?: string | Record<string, string>;
  iso: string;
  link: string;
}

// js/app.js localeDateStr parity: ar-DZ / fr-FR / en-US.
const DATE_LOCALE: Record<Lang, string> = { ar: 'ar-DZ', fr: 'fr-FR', en: 'en-US' };

function fmtDate(iso: string, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(DATE_LOCALE[lang], { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return d.toLocaleDateString();
  }
}

function NotFoundView() {
  const { t, lang } = useLang();
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="rounded-xl bg-white p-8 text-center">
        <div className="text-4xl">📢</div>
        <h1 className="mt-3 text-lg font-semibold text-zinc-800">{t('announcementNotFound')}</h1>
        <p className="mt-4">
          {/* Verbatim legacy js/announcement.js backlink: '‹ ' + t('announcements') */}
          <Link href="/announcements" className="inline-block font-semibold text-emerald-700">
            ‹ {t('announcements')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AnnouncementDetail({
  ann,
  error,
}: {
  ann: AnnouncementDetailData | null;
  error: boolean;
}) {
  const { t, lang } = useLang();

  if (error || !ann) {
    return <NotFoundView />;
  }

  const title = annLocalized(ann.title, lang) || t('announcements');
  const body = annLocalized(ann.body, lang);
  const date = fmtDate(ann.iso, lang);
  const link = annSafeLink(ann.link);

  return (
    <article
      className="rounded-xl bg-white p-4 shadow-sm sm:p-6"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="mb-3 flex items-center gap-2">
        <Link
          href="/announcements"
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
        >
          {t('back')}
        </Link>
        <ShareButton url={`/announcement/${ann.id}`} title={title} />
      </div>
      {/* Verbatim legacy js/announcement.js backlink: '‹ ' + t('announcements') */}
      <Link
        href="/announcements"
        className="mb-3 inline-block text-sm font-semibold text-emerald-700"
      >
        ‹ {t('announcements')}
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
          {t('announcementLink')}
        </a>
      )}
    </article>
  );
}
