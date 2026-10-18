// Listing h1 — client-side localized (R54).
//
// R54 root fix (18 Oct 2026): the listing page's SSR is language-invariant
// (Arabic) because the edge cache cannot vary by the dlala_lang cookie
// (verified live: Vary: Cookie and Cache-Control: private both ineffective).
// The h1 follows the UI language via useLang() — SSR renders Arabic (server
// snapshot), hydration picks up the reader's language. Same Round-107
// pattern as the homepage shell.

'use client';

import { useLang } from '@/lib/i18n';
import { cardTitle, type ListingCard } from '@/lib/firestore';

export default function ListingH1({ listing }: { listing: ListingCard }) {
  const { lang } = useLang();
  return (
    <h1 className="text-2xl font-bold text-zinc-900">{cardTitle(listing, lang)}</h1>
  );
}
