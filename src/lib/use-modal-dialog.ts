'use client';

// Shared modal-dialog keyboard + focus behavior (audit R32-4).
//
// Before this hook, the app's dialogs each hand-rolled their keyboard
// support — the shared Modal components handled Escape only, and the
// inline confirm dialogs (my-listings mark-sold/delete, alerts
// saved-search delete, settings, store-verify, vitrine, RateCta)
// handled nothing: Escape did not close them, Tab escaped into the
// page behind, focus never entered the dialog, and on close focus was
// lost to <body> instead of returning to the trigger.
//
// useModalDialog gives every dialog the standard behavior:
//   - on open, focus moves into the dialog (first focusable element,
//     else the dialog container itself);
//   - Tab / Shift+Tab cycle INSIDE the dialog (focus trap);
//   - Escape closes via the caller's own onClose (so guarded closes —
//     e.g. "not while sending" — keep their exact semantics);
//   - on close, focus returns to the element that opened the dialog.
//
// Usage (two shapes, same hook):
//   - mount-on-open components (the shared Modal shells): the hook is
//     called unconditionally and `open` defaults to true —
//       const dialogRef = useModalDialog({ onClose });
//       <div ref={dialogRef} role="dialog" aria-modal="true" …>
//   - inline dialogs in a page component (rendered conditionally by
//     state): pass the open flag —
//       const dialogRef = useModalDialog({ open: confirmId !== null, onClose: close });
//       {confirmId && <div ref={dialogRef} role="dialog" aria-modal="true" …>}
//
// Visuals, texts and confirm semantics are untouched — this hook only
// moves focus and answers keys. (The Gallery lightbox and the
// SiteChrome drawer predate it with their own complete
// implementations and are not migrated.)

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, in mount order. Only the topmost dialog answers
// Escape/Tab, so nested dialogs behave like a stack.
const openStack: object[] = [];

export function useModalDialog<T extends HTMLElement = HTMLDivElement>(opts: {
  open?: boolean;
  onClose: () => void;
}): RefObject<T | null> {
  const dialogRef = useRef<T | null>(null);
  const open = opts.open !== false;
  // The key handler always calls the LATEST onClose (callers pass
  // inline closures whose captured state changes every render).
  const onCloseRef = useRef(opts.onClose);
  useEffect(() => {
    onCloseRef.current = opts.onClose;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const token = {};
    openStack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0
      );

    // Focus into the dialog: first focusable, else the container.
    const initial = focusables();
    if (initial.length) initial[0].focus();
    else {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      dialog.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) {
        // Nothing focusable inside — keep focus on the container.
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !dialog.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !dialog.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase: the topmost dialog answers before any page-level
    // bubble-phase Escape handlers (e.g. the drawer's) can fire.
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      const i = openStack.indexOf(token);
      if (i >= 0) openStack.splice(i, 1);
      // Restore focus to the opener (R32-4: it was lost to <body>).
      // The opener may be gone (navigation, list re-render) — then
      // there is nothing truthful to restore to.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  return dialogRef;
}
