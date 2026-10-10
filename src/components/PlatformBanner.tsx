// Platform banner (Android/iOS) — js/app.js renderPlatformBanner + js/banner-early.js parity.
//
// Fixed top banner on every page (above the sticky header — document.body.prepend
// in legacy, here rendered first inside the chrome): Android → Play Store link,
// iPhone → same banner, the App Store badge shows a "coming soon" toast.
// Dismissal is honored per platform via sessionStorage (dlala_app_banner /
// dlala_ios_banner); the banner follows language switches via useLang re-render.

'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=dz.dlala.dlala';

type Platform = 'android' | 'ios';

function detectPlatform(): Platform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  // js/app.js isIOS parity (iPad/iPod + touch Macs = iOS-class).
  if (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return null;
}

function storageKey(p: Platform): string {
  return p === 'android' ? 'dlala_app_banner' : 'dlala_ios_banner';
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08l-.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M3.6 2.3c-.3.3-.5.8-.5 1.4v16.6c0 .6.2 1.1.5 1.4l.1.1 9.3-9.3v-.2L3.7 2.2l-.1.1z" />
      <path d="M16.9 15.4L13 11.5v-.2l3.9-3.9 5.2 3c1.5.8 1.5 2.4 0 3.2l-5.2 2.8z" opacity=".8" />
      <path d="M4.2 2.5l8.8 8.8v.2L4.2 20.3c-.3-.3-.5-.8-.5-1.4V3.9c0-.6.2-1.1.5-1.4z" opacity=".6" />
    </svg>
  );
}

export default function PlatformBanner({ onToast }: { onToast: (msg: string) => void }) {
  const { lang, t } = useLang();
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [dismissed, setDismissed] = useState(true);

  // Client-only: UA + sessionStorage are not available during SSR (no hydration mismatch).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- mount-time client-only platform/dismissal read (navigator + sessionStorage); legacy banner-early.js is browser-only by design */
    const p = detectPlatform();
    if (!p) return;
    try {
      if (sessionStorage.getItem(storageKey(p))) return;
    } catch {
      return;
    }
    setPlatform(p);
    setDismissed(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  if (!platform || dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(storageKey(platform), '1'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div id="appBanner" data-lang={lang}>
      <span className="appb-logo" aria-hidden="true">
        <span className="logo-d">D</span>
        <span className="logo-dot">.</span>
      </span>
      <span className="appb-text">
        <strong>{t('downloadAppTitle')}</strong>
      </span>
      <span className="appb-badges">
        <button
          className="appb-badge"
          type="button"
          onClick={() => onToast(t('comingSoon'))}
        >
          <AppleIcon />
          <span>App Store</span>
        </button>
        <a className="appb-badge" href={PLAY_STORE_URL}>
          <PlayIcon />
          <span>Google Play</span>
        </a>
      </span>
      <button
        className="appb-x"
        type="button"
        aria-label={t('dismiss')}
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  );
}
