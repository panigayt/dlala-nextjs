'use client';

// Alerts center — mirrors js/alerts.js.
// Sections: new matches (client-side saved-search matcher), notifications
// inbox (in-app only — NO push), saved-search CRUD (cap 10).
// All user-facing strings verbatim from js/i18n.ar.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  useRequireAuth,
  LoadingSpinner,
  FirebaseClient,
  CompatUser,
  inputCls,
  btnCls,
  btnSecondaryCls,
} from '@/lib/firebase-client';
import { formatPrice, timeAgo } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';

// Verbatim from js/i18n.ar.js
const STR = {
  alerts: 'التنبيهات',
  newMatches: 'مطابقات جديدة',
  notificationsTitle: 'الإشعارات',
  markAllRead: 'تحديد الكل كمقروء',
  savedSearches: 'عمليات البحث المحفوظة',
  newSavedSearch: 'حفظ بحث جديد',
  searchKeyword: 'الكلمة المفتاحية',
  searchCategory: 'الفئة',
  searchWilaya: 'الولاية',
  searchMinPrice: 'السعر الأدنى',
  searchMaxPrice: 'السعر الأقصى',
  createSearch: 'حفظ البحث',
  updateSearch: 'تحديث البحث',
  cancelEdit: 'إلغاء التعديل',
  searchEnabled: 'مفعّل',
  searchDisabled: 'معطّل',
  enableSearch: 'تفعيل',
  disableSearch: 'إيقاف',
  editSearch: 'تعديل البحث',
  delete: 'حذف',
  deleteSearchConfirm: 'حذف هذا البحث المحفوظ؟',
  searchUpdated: 'تم تحديث البحث',
  maxSearchesReached: 'وصلت إلى الحد الأقصى (10 عمليات بحث).',
  searchNeedsCriteria: 'أدخل كلمة أو اختر فئة أو ولاية أو سعرًا قبل حفظ البحث',
  noSavedSearches: 'لا توجد عمليات بحث محفوظة بعد.',
  noNotifications: 'لا توجد إشعارات.',
  noNewMatches: 'لا توجد إعلانات جديدة مطابقة لبحوثك.',
  allCategories: 'كل الأقسام',
  allWilayas: 'كل الولايات',
  loading: 'جارٍ التحميل...',
  errorGeneric: 'حدث خطأ — حاول مجدداً',
  retry: 'إعادة المحاولة',
  followedYou: '{name} بدأ بمتابعتك',
  // Verbatim js/i18n.ar.js 'notif.price_drop' (read-time template — the
  // writer stores title:'' and the sentence renders in the reader's
  // language, per 0.0.0.31 D-2).
  notifPriceDrop: 'انخفض سعر {title}: من {oldPrice} إلى {newPrice}',
};

// Verbatim from js/categories.js
const CATEGORIES = [
  { id: 'phones', ar: 'هواتف' },
  { id: 'cars', ar: 'سيارات' },
  { id: 'moto', ar: 'دراجات نارية' },
  { id: 'electronics', ar: 'إلكترونيات' },
  { id: 'phone_acc', ar: 'إكسسوارات هواتف' },
  { id: 'realestate', ar: 'عقارات' },
  { id: 'furniture', ar: 'أثاث' },
  { id: 'home', ar: 'المنزل' },
  { id: 'clothes', ar: 'ملابس' },
  { id: 'shoes', ar: 'أحذية' },
  { id: 'kids', ar: 'مستلزمات الأطفال' },
  { id: 'sports', ar: 'رياضة' },
  { id: 'velos', ar: 'دراجات هوائية' },
  { id: 'trottinettes', ar: 'تروتينات' },
  { id: 'books', ar: 'كتب' },
  { id: 'animals', ar: 'حيوانات' },
  { id: 'services', ar: 'خدمات' },
  { id: 'machines', ar: 'آلات ومعدات' },
  { id: 'spareparts', ar: 'قطع غيار' },
  { id: 'jobs', ar: 'وظائف' },
  { id: 'beauty', ar: 'عطور وعناية وتجميل' },
  { id: 'other', ar: 'أخرى' },
];

function catName(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.ar || id;
}

function wilayaName(code: number | null | undefined): string {
  if (code == null) return '';
  const w = WILAYAS.find((x) => x.code === code);
  return w ? `${w.code} - ${w.ar}` : String(code);
}

function tsMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return 0;
}

function localizedTitle(title: unknown): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const o = title as Record<string, string>;
    return o.ar || o.fr || o.en || '';
  }
  return '';
}

// Arabic-aware normalization — mirrors the legacy anti-duplicate
// normalization (tashkeel/tatweel stripped, alef/hamza unified, ة→ه,
// ى→ي, eastern digits→ASCII).
function normAr(s: string): string {
  return String(s || '')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .toLowerCase()
    .trim();
}

interface SavedSearch {
  id: string;
  query?: string;
  categoryId?: string;
  wilayaCode?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  enabled?: boolean;
}

interface FreshListing {
  id: string;
  title: unknown;
  price?: number;
  categoryId?: string;
  wilayaCode?: number;
  isWanted?: boolean;
  createdAt?: unknown;
  photoUrls?: string[];
  photo_thumbs?: (string | null)[];
  thumbUrls?: string[];
}

function matchesSavedSearch(l: FreshListing, s: SavedSearch): boolean {
  // Verbatim from js/market.js (line 143): wanted ads never match a
  // regular saved search — they have their own /wanted page.
  if (l.isWanted) return false;
  if (s.categoryId && l.categoryId !== s.categoryId) return false;
  if (s.wilayaCode != null && l.wilayaCode !== s.wilayaCode) return false;
  if (s.minPrice != null && (l.price || 0) < s.minPrice) return false;
  if (s.maxPrice != null && (l.price || 0) > s.maxPrice) return false;
  const q = normAr(s.query || '');
  if (q) {
    const hay = normAr(localizedTitle(l.title));
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every((tk) => hay.includes(tk))) return false;
  }
  return true;
}

interface Notif {
  id: string;
  type?: string;
  title?: string;
  body?: string;
  read?: boolean;
  createdAt?: unknown;
  data?: {
    conversationId?: string;
    listingId?: string;
    followerUid?: string;
    followerName?: string;
    // price_drop payload (js/publish.js writer)
    title?: string;
    oldPrice?: number;
    newPrice?: number;
    photo?: string | null;
  };
}

// Resolve a notification's navigation target — mirrors alerts.js
// notifTarget(). Returns a relative in-app URL or null.
function notifTarget(n: Notif): string | null {
  if (!n || typeof n !== 'object') return null;
  const d = n.data || {};
  if (
    (n.type === 'new_message' ||
      n.type === 'phone_request' ||
      n.type === 'deal_confirmed') &&
    d.conversationId
  ) {
    return '/chat/' + encodeURIComponent(d.conversationId);
  }
  if (
    (n.type === 'saved_search_match' ||
      n.type === 'price_drop' ||
      n.type === 'new_favorite') &&
    d.listingId
  ) {
    return '/listing/' + encodeURIComponent(d.listingId);
  }
  if (n.type === 'message' && d.conversationId) {
    return '/chat/' + encodeURIComponent(d.conversationId);
  }
  if (
    (n.type === 'favorite' || n.type === 'priceDrop' || n.type === 'savedSearch') &&
    d.listingId
  ) {
    return '/listing/' + encodeURIComponent(d.listingId);
  }
  if (n.type === 'follow' && d.followerUid) {
    return '/seller/' + encodeURIComponent(d.followerUid);
  }
  return null;
}

function notifTitle(n: Notif): string {
  if (n.type === 'follow') {
    return STR.followedYou.replace(
      '{name}',
      String((n.data && n.data.followerName) || '')
    );
  }
  // 0.0.0.31 D-2: price_drop renders from the i18n template at READ time
  // (placeholders from n.data) — legacy's writer stores title:''.
  if (n.type === 'price_drop') {
    const d = n.data || {};
    const str = (v: unknown) => String(v == null ? '' : v);
    return STR.notifPriceDrop
      .split('{title}')
      .join(str(d.title))
      .split('{oldPrice}')
      .join(formatPrice(Number(d.oldPrice) || 0))
      .split('{newPrice}')
      .join(formatPrice(Number(d.newPrice) || 0));
  }
  return n.title || '';
}

function searchMeta(s: SavedSearch): string {
  const bits: string[] = [];
  if (s.categoryId) bits.push(catName(s.categoryId));
  if (s.wilayaCode != null) bits.push(wilayaName(s.wilayaCode));
  if (s.minPrice != null)
    bits.push(`≥ ${Number(s.minPrice).toLocaleString('en-US')}`);
  if (s.maxPrice != null)
    bits.push(`≤ ${Number(s.maxPrice).toLocaleString('en-US')}`);
  return bits.join(' · ');
}

function listingThumb(l: FreshListing): string {
  const t =
    (l.photo_thumbs && l.photo_thumbs[0]) ||
    (l.thumbUrls && l.thumbUrls[0]) ||
    (l.photoUrls && l.photoUrls[0]) ||
    '';
  return t || '';
}

export default function AlertsPage() {
  const authState = useRequireAuth();
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [matches, setMatches] = useState<
    { search: SavedSearch; hits: FreshListing[] }[]
  >([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // form fields
  const [fQ, setFQ] = useState('');
  const [fCat, setFCat] = useState('');
  const [fWilaya, setFWilaya] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<FirebaseClient | null>(null);
  const userRef = useRef<CompatUser | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const loadAll = useCallback(
    async (client: FirebaseClient, user: CompatUser) => {
      // NOTE: loading/error are NOT set synchronously here — the initial
      // useState(true) covers first paint, and retry buttons set them in
      // their (allowed) event handlers. All setState below happens in
      // async continuations (after await).
      try {
        // Saved searches
        const sSnap = await client.db
          .collection(`users/${user.uid}/savedSearches`)
          .get();
        const docs: SavedSearch[] = sSnap.docs.map((d) => ({
          id: d.id,
          ...((d.data() || {}) as object),
        })) as SavedSearch[];
        setSearches(docs);

        // Fresh listings for matching
        const active = docs.filter((s) => s.enabled);
        const matchGroups: { search: SavedSearch; hits: FreshListing[] }[] = [];
        if (active.length) {
          const lSnap = await client.db
            .collection('listings')
            .where('status', 'in', ['available', 'negotiating'])
            .orderBy('createdAt', 'desc')
            .limit(60)
            .get()
            .catch(() =>
              // No composite index: unordered fallback, client-sorted
              client.db.collection('listings').limit(60).get()
            );
          const fresh: FreshListing[] = lSnap.docs.map(
            (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as FreshListing
          );
          const seenKey = `dlala_seen_${user.uid}`;
          let seen: Record<string, number> = {};
          try {
            const raw = JSON.parse(localStorage.getItem(seenKey) || '{}');
            if (raw && typeof raw === 'object') seen = raw;
          } catch {
            /* ignore */
          }
          const nowSeen = { ...seen };
          for (const s of active) {
            const hits = fresh.filter((l) => matchesSavedSearch(l, s)).slice(0, 6);
            if (!hits.length) continue;
            const last = seen[s.id] || 0;
            for (const h of hits) {
              const t = tsMs(h.createdAt);
              if (t > last) nowSeen[s.id] = Math.max(nowSeen[s.id] || 0, t);
            }
            matchGroups.push({ search: s, hits });
          }
          try {
            localStorage.setItem(seenKey, JSON.stringify(nowSeen));
          } catch {
            /* ignore */
          }
        }
        setMatches(matchGroups);

        // Notifications
        const nSnap = await client.db
          .collection(`users/${user.uid}/notifications`)
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get()
          .catch(() =>
            client.db.collection(`users/${user.uid}/notifications`).limit(30).get()
          );
        const nDocs: Notif[] = nSnap.docs
          .map(
            (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Notif
          )
          .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
        setNotifs(nDocs);
      } catch {
        setError(STR.errorGeneric);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (authState.status !== 'signed-in') return;
    clientRef.current = authState.client;
    userRef.current = authState.user;
    // Data-fetch effect: loadAll is async and only sets state in async
    // continuations (after await). No synchronous setState — the
    // cascading-render concern does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll(authState.client, authState.user);
  }, [authState, loadAll]);

  function resetForm() {
    setEditingId(null);
    setFQ('');
    setFCat('');
    setFWilaya('');
    setFMin('');
    setFMax('');
  }

  function startEdit(s: SavedSearch) {
    setEditingId(s.id);
    setFQ(s.query || '');
    setFCat(s.categoryId || '');
    setFWilaya(s.wilayaCode == null ? '' : String(s.wilayaCode));
    setFMin(s.minPrice == null ? '' : String(s.minPrice));
    setFMax(s.maxPrice == null ? '' : String(s.maxPrice));
    document
      .getElementById('savedSearchForm')
      ?.scrollIntoView({ block: 'start' });
  }

  async function saveSearch(ev: React.FormEvent) {
    ev.preventDefault();
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    const hasCriteria =
      fQ.trim() || fCat || fWilaya !== '' || fMin !== '' || fMax !== '';
    if (!hasCriteria) {
      showToast(STR.searchNeedsCriteria);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        query: fQ.trim(),
        categoryId: fCat || '',
        wilayaCode: fWilaya === '' ? null : Number(fWilaya),
        minPrice: fMin === '' ? null : Number(fMin),
        maxPrice: fMax === '' ? null : Number(fMax),
      };
      const col = client.db.collection(`users/${user.uid}/savedSearches`);
      if (editingId) {
        await col.doc(editingId).update(payload);
        showToast(STR.searchUpdated);
        resetForm();
      } else {
        const existing = await col.get();
        if (existing.size >= 10) {
          showToast(STR.maxSearchesReached);
          setSaving(false);
          return;
        }
        await col.add({
          userId: user.uid,
          ...payload,
          enabled: true,
          createdAt: client.FieldValue.serverTimestamp(),
        });
        resetForm();
      }
      await loadAll(client, user);
    } catch {
      showToast(STR.errorGeneric);
    } finally {
      setSaving(false);
    }
  }

  async function toggleSearch(s: SavedSearch) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    try {
      await client.db
        .collection(`users/${user.uid}/savedSearches`)
        .doc(s.id)
        .update({ enabled: !s.enabled });
      await loadAll(client, user);
    } catch {
      showToast(STR.errorGeneric);
    }
  }

  async function deleteSearch(s: SavedSearch) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    if (!window.confirm(STR.deleteSearchConfirm)) return;
    if (s.id === editingId) resetForm();
    try {
      await client.db
        .collection(`users/${user.uid}/savedSearches`)
        .doc(s.id)
        .delete();
      await loadAll(client, user);
    } catch {
      showToast(STR.errorGeneric);
    }
  }

  async function markAllRead() {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    const unread = notifs.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const batch = client.db.batch();
      const col = client.db.collection(`users/${user.uid}/notifications`);
      unread.forEach((n) => batch.update(col.doc(n.id), { read: true }));
      await batch.commit();
      await loadAll(client, user);
    } catch {
      showToast(STR.errorGeneric);
    }
  }

  async function openNotif(n: Notif) {
    const client = clientRef.current;
    const user = userRef.current;
    const target = notifTarget(n);
    if (!target) return;
    // Trust boundary: only relative in-app targets.
    if (!/^(\/chat\/|\/listing\/|\/seller\/)/.test(target)) return;
    if (client && user && !n.read) {
      try {
        await client.db
          .collection(`users/${user.uid}/notifications`)
          .doc(n.id)
          .update({ read: true });
      } catch {
        /* best-effort — still navigate */
      }
    }
    router.push(target);
  }

  if (authState.status !== 'signed-in') {
    return <LoadingSpinner label={STR.loading} />;
  }

  const hasUnread = notifs.some((n) => !n.read);

  return (
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <main className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-5">
          🔔 {STR.alerts}
        </h1>

        {loading && (
          <div className="text-center py-10">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-200 border-t-emerald-700" />
            <p className="mt-4 text-zinc-600">{STR.loading}</p>
          </div>
        )}

        {error && !loading && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
            <p className="mb-2">⚠️ {error}</p>
            <button
              className={btnSecondaryCls}
              onClick={() => {
                if (clientRef.current && userRef.current) {
                  setLoading(true);
                  setError(null);
                  loadAll(clientRef.current, userRef.current);
                }
              }}
            >
              {STR.retry}
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <h2 className="font-bold text-zinc-900 mt-2 mb-3">
              {STR.newMatches}
            </h2>
            <div className="space-y-4">
              {matches.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  {searches.filter((s) => s.enabled).length === 0
                    ? STR.noSavedSearches
                    : STR.noNewMatches}
                </div>
              )}
              {matches.map(({ search, hits }) => (
                <div key={search.id}>
                  <h3 className="text-sm font-bold text-zinc-700 my-2">
                    🔎 {search.query || searchMeta(search) || '—'}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {hits.map((h) => {
                      const thumb = listingThumb(h);
                      return (
                      <a
                        key={h.id}
                        href={`/listing/${encodeURIComponent(h.id)}`}
                        className="rounded-xl bg-white shadow-sm overflow-hidden no-underline hover:shadow"
                      >
                        {thumb ? (
                          <span className="relative block w-full h-28">
                            <Image
                              unoptimized
                              src={thumb}
                              alt=""
                              fill
                              sizes="(max-width: 640px) 50vw, 300px"
                              className="object-cover"
                            />
                          </span>
                        ) : (
                          <div className="w-full h-28 bg-zinc-100 flex items-center justify-center text-2xl">
                            📷
                          </div>
                        )}
                        <div className="p-2">
                          <div className="text-xs font-medium text-zinc-900 truncate">
                            {localizedTitle(h.title)}
                          </div>
                          <div className="text-sm font-bold text-emerald-700">
                            {formatPrice(h.price || 0)}
                          </div>
                        </div>
                      </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <h2 className="font-bold text-zinc-900 mt-8 mb-3">
              {STR.notificationsTitle}
            </h2>
            <div className="mb-3">
              <button
                className={btnSecondaryCls}
                onClick={markAllRead}
                disabled={!hasUnread}
              >
                {STR.markAllRead}
              </button>
            </div>
            <div className="space-y-2">
              {notifs.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  📭 {STR.noNotifications}
                </div>
              )}
              {notifs.map((n) => {
                const target = notifTarget(n);
                const inner = (
                  <>
                    <div className="font-bold text-zinc-900 text-sm">
                      {notifTitle(n)}
                    </div>
                    {n.body && (
                      <div className="text-sm text-zinc-600">{n.body}</div>
                    )}
                    <div className="text-xs text-zinc-400 mt-1">
                      {timeAgo(
                        tsMs(n.createdAt)
                          ? new Date(tsMs(n.createdAt))
                          : undefined
                      )}
                    </div>
                  </>
                );
                const cls = `rounded-xl shadow-sm p-3 bg-white ${n.read ? '' : 'border-r-4 border-r-emerald-600'}`;
                return target ? (
                  <a
                    key={n.id}
                    href={target}
                    onClick={(e) => {
                      e.preventDefault();
                      openNotif(n);
                    }}
                    className={cls + ' block no-underline hover:bg-zinc-50'}
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={n.id} className={cls}>
                    {inner}
                  </div>
                );
              })}
            </div>

            <h2 className="font-bold text-zinc-900 mt-8 mb-3">
              {STR.savedSearches}
            </h2>
            <div className="space-y-2">
              {searches.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  🔔 {STR.noSavedSearches}
                </div>
              )}
              {searches.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl bg-white shadow-sm p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-zinc-900 text-sm">
                      {s.query || '—'}
                    </strong>
                    <span className="text-xs text-zinc-400">
                      {s.enabled ? STR.searchEnabled : STR.searchDisabled}
                    </span>
                  </div>
                  {searchMeta(s) && (
                    <div className="text-xs text-zinc-500 mt-1">
                      {searchMeta(s)}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm'}
                      onClick={() => toggleSearch(s)}
                    >
                      {s.enabled ? STR.disableSearch : STR.enableSearch}
                    </button>
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm'}
                      onClick={() => startEdit(s)}
                    >
                      {STR.editSearch}
                    </button>
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm !text-red-600'}
                      onClick={() => deleteSearch(s)}
                    >
                      {STR.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              id="savedSearchForm"
              onSubmit={saveSearch}
              className="rounded-xl bg-white shadow-sm p-4 mt-4"
              noValidate
            >
              <h3 className="font-bold text-zinc-900 mb-3">
                {STR.newSavedSearch}
              </h3>
              <label
                htmlFor="sQ"
                className="block text-sm font-medium text-zinc-700 mb-1"
              >
                {STR.searchKeyword}
              </label>
              <input
                id="sQ"
                maxLength={60}
                className={inputCls + ' mb-3'}
                value={fQ}
                onChange={(e) => setFQ(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sCat"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {STR.searchCategory}
                  </label>
                  <select
                    id="sCat"
                    className={inputCls}
                    value={fCat}
                    onChange={(e) => setFCat(e.target.value)}
                  >
                    <option value="">{STR.allCategories}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sWilaya"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {STR.searchWilaya}
                  </label>
                  <select
                    id="sWilaya"
                    className={inputCls}
                    value={fWilaya}
                    onChange={(e) => setFWilaya(e.target.value)}
                  >
                    <option value="">{STR.allWilayas}</option>
                    {WILAYAS.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w.ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sMin"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {STR.searchMinPrice}
                  </label>
                  <input
                    id="sMin"
                    type="number"
                    min={0}
                    dir="ltr"
                    className={inputCls + ' text-left'}
                    value={fMin}
                    onChange={(e) => setFMin(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="sMax"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {STR.searchMaxPrice}
                  </label>
                  <input
                    id="sMax"
                    type="number"
                    min={0}
                    dir="ltr"
                    className={inputCls + ' text-left'}
                    value={fMax}
                    onChange={(e) => setFMax(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="submit" className={btnCls + ' !w-auto !px-6'} disabled={saving}>
                  {editingId ? STR.updateSearch : STR.createSearch}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className={btnSecondaryCls}
                    onClick={resetForm}
                  >
                    {STR.cancelEdit}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-zinc-900 text-white px-5 py-3 shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
