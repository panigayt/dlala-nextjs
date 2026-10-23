// UrlLangSync — R23-4 fix (24 Oct 2026). Mounted by the localized app
// routes (/fr/publish, /en/publish): syncs the app-wide language store
// to the URL's language on mount (see syncAppLangToUrl in lib/i18n.tsx
// for why the publish routes specifically need this — their auth gate
// detours through the unprefixed, store-driven /auth page). Renders
// nothing.
'use client';

import { useEffect } from 'react';
import { syncAppLangToUrl, type Lang } from '@/lib/i18n';

export default function UrlLangSync({ lang }: { lang: Lang }) {
  useEffect(() => {
    syncAppLangToUrl(lang);
  }, [lang]);
  return null;
}
