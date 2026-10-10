'use client';

// Save-this-search button — mirrors js/home.js saveCurrentSearch (HOM-6).
// Its own action row, not a filter input. Guests get the loginToSaveSearch
// nudge first (legacy guestNudgeThenLogin sweep), then a redirect to
// /auth?return=<this page>.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from '@/lib/firebase-client';
import type { SearchFilters } from '@/lib/firestore';

// Verbatim from js/i18n.ar.js
const STR = {
  saveThisSearch: 'حفظ هذا البحث',
  searchSaved: 'تم حفظ البحث.',
  maxSearchesReached: 'وصلت إلى الحد الأقصى (10 عمليات بحث).',
  searchNeedsCriteria: 'أدخل كلمة أو اختر فئة أو ولاية أو سعرًا قبل حفظ البحث',
  loginToSaveSearch: 'سجّل الدخول لحفظ هذا البحث',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
};

export default function SaveSearchButton({ filters }: { filters: SearchFilters }) {
  const auth = useAuthState();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const onSave = useCallback(async () => {
    // 0.0.0.7: read the header search box itself — a user who types then
    // taps "save" directly would otherwise save query:"".
    let q = (filters.q || '').trim();
    try {
      const box = document.querySelector(
        'header input[name="q"]'
      ) as HTMLInputElement | null;
      if (box && box.value.trim()) q = box.value.trim();
    } catch {
      /* ignore */
    }
    const hasCriteria = q || filters.cat || filters.wilaya || filters.min || filters.max;
    if (!hasCriteria) {
      showToast(STR.searchNeedsCriteria);
      return;
    }

    // Guests: nudge first (legacy sweep), then login with a return URL.
    if (auth.status !== 'signed-in') {
      showToast(STR.loginToSaveSearch);
      const ret = encodeURIComponent(window.location.pathname + window.location.search);
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
        showToast(STR.maxSearchesReached);
        return;
      }
      await col.add({
        userId: user.uid,
        query: q,
        categoryId: filters.cat || '',
        wilayaCode: filters.wilaya ? Number(filters.wilaya) : null,
        minPrice: filters.min ? Number(filters.min) : null,
        maxPrice: filters.max ? Number(filters.max) : null,
        enabled: true,
        createdAt: client.FieldValue.serverTimestamp(),
      });
      showToast(STR.searchSaved);
    } catch {
      showToast(STR.errorGeneric);
    } finally {
      setSaving(false);
    }
  }, [auth, filters, router, showToast]);

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || auth.status === 'loading'}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 transition-colors"
      >
        {saving ? 'جارٍ الحفظ...' : STR.saveThisSearch}
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
