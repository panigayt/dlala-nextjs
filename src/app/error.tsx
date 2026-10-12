'use client';
// 11 Oct 2026: App Router error boundary — localized fallback instead of blank 500.
import { useEffect } from 'react';
import { useLang } from '@/lib/i18n';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  // 11 Oct 2026: dir follows language (was hardcoded rtl).
  // 12 Oct 2026 (Round 9): show ONLY the current language's message
  // (was rendering ar + fr + en stacked).
  const { lang, t } = useLang();
  const msg =
    lang === 'fr'
      ? "Une erreur inattendue s'est produite"
      : lang === 'en'
        ? 'An unexpected error occurred'
        : 'حدث خطأ غير متوقع';
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-md w-full rounded-xl bg-white shadow-sm p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-zinc-900 mb-6" lang={lang}>
          {msg}
        </h1>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-white font-medium hover:bg-emerald-800"
          >
            {t('retry')}
          </button>
          <a
            href="/"
            className="rounded-lg border border-zinc-300 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {t('home')}
          </a>
        </div>
      </div>
    </div>
  );
}
