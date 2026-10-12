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
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: '28rem', width: '100%', borderRadius: '0.75rem', backgroundColor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.25rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#18181b', marginBottom: '1.5rem' }}>
              حدث خطأ غير متوقع / An unexpected error occurred
            </h1>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={reset}
                style={{ borderRadius: '0.5rem', backgroundColor: '#047857', padding: '0.5rem 1rem', color: '#fff', fontWeight: '500', border: 'none', cursor: 'pointer' }}
              >
                حاول مجددا / Réessayer / Try again
              </button>
              <a
                href="/"
                style={{ borderRadius: '0.5rem', border: '1px solid #d4d4d8', padding: '0.5rem 1rem', fontWeight: '500', color: '#3f3f46', textDecoration: 'none' }}
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
