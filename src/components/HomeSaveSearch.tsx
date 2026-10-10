'use client';

// HomeSaveSearch — Round 152.
// Save-this-search action row on the homepage — 0.0.0.39 HOM-6 parity.
// Production renders the button in #searchActions (its own row below the
// filters, not a filter input). Reads the live homepage filter form values
// at click time, then delegates to the same savedSearches write path as
// the search page (users/{uid}/savedSearches, cap 10). Guests get the
// loginToSaveSearch nudge + redirect to /auth.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n';
import { useAuthState } from '@/lib/firebase-client';

function readHomeFilters(): {
  q: string;
  cat: string;
  wilaya: string;
  min: string;
  max: string;
} {
  const val = (sel: string): string => {
    try {
      const el = document.querySelector(sel) as
        | HTMLInputElement
        | HTMLSelectElement
        | null;
      return el && el.value ? el.value.trim() : '';
    } catch {
      return '';
    }
  };
  // Header search box (same selector the search-page button uses).
  let q = '';
  try {
    const box = document.querySelector(
      'header input[name="q"]'
    ) as HTMLInputElement | null;
    if (box && box.value.trim()) q = box.value.trim();
  } catch {
    /* ignore */
  }
  return {
    q,
    cat: '',
    wilaya: val('#home-wilaya'),
    min: val('#home-min'),
    max: val('#home-max'),
  };
}

export default function HomeSaveSearch() {
  const { t } = useLang();
  const auth = useAuthState();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const onSave = useCallback(async () => {
    const f = readHomeFilters();
    const hasCriteria = f.q || f.cat || f.wilaya || f.min || f.max;
    if (!hasCriteria) {
      showToast(t('searchNeedsCriteria'));
      return;
    }
    if (auth.status !== 'signed-in') {
      showToast(t('loginToSaveSearch'));
      const ret = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.setTimeout(() => {
        router.push(`/auth?return=${ret}`);
      }, 1500);
      return;
    }
    const { user, client } = auth;
    setSaving(true);
    try {
      const col = client.db.collection(`users/${user.uid}/savedSearches`);
      const existing = await col.get();
      if (existing.size >= 10) {
        showToast(t('maxSearchesReached'));
        return;
      }
      await col.add({
        userId: user.uid,
        query: f.q,
        categoryId: f.cat || '',
        wilayaCode: f.wilaya ? Number(f.wilaya) : null,
        minPrice: f.min ? Number(f.min) : null,
        maxPrice: f.max ? Number(f.max) : null,
        enabled: true,
        createdAt: client.FieldValue.serverTimestamp(),
      });
      showToast(t('searchSaved'));
    } catch {
      showToast(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }, [auth, router, showToast, t]);

  return (
    <div className="search-actions" style={{ display: 'flex', justifyContent: 'flex-end', margin: '-8px 0 14px' }}>
      <button
        type="button"
        id="saveSearchBtn"
        onClick={onSave}
        disabled={saving || auth.status === 'loading'}
        className="rounded-lg border border-emerald-700 bg-white px-4 py-2.5 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 transition-colors"
      >
        {saving ? t('saving') : t('saveThisSearch')}
      </button>
      {toast ? (
        <div
          role="status"
          className="mt-2 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
