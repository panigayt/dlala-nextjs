// Announcement detail share button (client component).
//
// Mirrors js/announcements.js annShare(): Web Share API when the browser
// offers it, clipboard copy-link fallback otherwise (with the legacy
// textarea fallback), and the t('linkCopied') toast ONLY on a clipboard
// copy — legacy annShare() does not toast after navigator.share().
//
// Round 120: label + toast follow the UI language via the app-wide store
// (useLang); local toast state follows the FavoriteToggle pattern.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/lib/i18n';

export default function ShareButton({ url, title }: { url: string; title: string }) {
  const { t } = useLang();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    const timerRef = toastTimer;
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const onShare = async () => {
    // Resolve to an absolute URL for the clipboard fallback
    // (navigator.share also accepts it).
    let abs = url;
    try {
      abs = new URL(url, window.location.href).href;
    } catch {
      abs = url;
    }
    // Legacy parity: the toast fires only when the link was COPIED.
    const done = () => showToast(t('linkCopied'));
    // Legacy textarea fallback (js/announcements.js copyLegacy).
    const copyLegacy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = abs;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch {
        // Clipboard unavailable — nothing to do.
      }
    };
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title, url: abs });
      } catch {
        // User cancelled the share sheet — nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(abs);
      done();
    } catch {
      copyLegacy();
    }
  };

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={onShare}
        className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
      >
        {t('share')}
      </button>
      {toast && (
        <span
          role="status"
          className="absolute start-full top-1/2 z-10 ms-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {toast}
        </span>
      )}
    </span>
  );
}
