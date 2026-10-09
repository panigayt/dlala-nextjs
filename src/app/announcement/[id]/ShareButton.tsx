// Announcement detail share button (client component).
//
// Mirrors js/announcements.js annShare(): Web Share API when the browser
// offers it, clipboard copy-link fallback otherwise.

'use client';

export default function ShareButton({ url, title }: { url: string; title: string }) {
  const onShare = async () => {
    // Resolve to an absolute URL for the clipboard fallback
    // (navigator.share also accepts it).
    let abs = url;
    try {
      abs = new URL(url, window.location.href).href;
    } catch {
      abs = url;
    }
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
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200"
    >
      <span lang="ar" dir="rtl">
        مشاركة
      </span>
      <span lang="fr" dir="ltr" className="sr-only">
        {' '}
        / Partager
      </span>
      <span lang="en" dir="ltr" className="sr-only">
        {' '}
        / Share
      </span>
    </button>
  );
}
