'use client';
// 11 Oct 2026: Global error boundary for root layout crashes.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-xl bg-white shadow-sm p-8 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-zinc-900 mb-6">
              حدث خطأ غير متوقع / An unexpected error occurred
            </h1>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-white font-medium"
              >
                حاول مجددا / Réessayer / Try again
              </button>
              <a
                href="/"
                className="rounded-lg border border-zinc-300 px-4 py-2 font-medium text-zinc-700"
              >
                الرئيسية / Accueil / Home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
