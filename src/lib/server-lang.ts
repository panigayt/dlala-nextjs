// Server-side UI-language reader (Round 133).
//
// generateMetadata runs on the server and cannot read the client's
// localStorage — the client mirrors every language switch into the
// `dlala_lang` cookie (see writeLangCookie/setAppLang in ./i18n), which
// this module reads. Defaults to 'ar' when absent.
//
// SERVER-ONLY: imports next/headers. Never import this from a client
// component. String lookup comes from ./i18n-strings (no 'use client'
// directive), so generateMetadata can call t() directly.
import { cookies } from 'next/headers';
import { type Lang } from './i18n-strings';

/** UI language for server rendering — from the dlala_lang cookie, else 'ar'. */
export async function getServerLang(): Promise<Lang> {
  try {
    const store = await cookies();
    const v = store.get('dlala_lang')?.value;
    if (v === 'fr' || v === 'en' || v === 'ar') return v;
  } catch {
    // a language must never break rendering
  }
  return 'ar';
}
