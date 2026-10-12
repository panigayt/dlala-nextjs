'use client';

// Alerts center — mirrors js/alerts.js.
// Sections: new matches (client-side saved-search matcher), notifications
// inbox (in-app only — NO push), saved-search CRUD (cap 10).
// All user-facing strings verbatim from js/i18n.ar.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
// 12 Oct 2026 (Round 12): migrated to the modular Firebase SDK (@/lib/firebase).
import {
  useRequireAuth,
  LoadingSpinner,
  type FirebaseClient,
  type CompatUser,
  inputCls,
  btnCls,
  btnSecondaryCls,
} from '@/lib/firebase';
import { formatPrice, timeAgo } from '@/lib/firestore';
import { WILAYAS } from '@/lib/wilayas';
import { snapshotRead, snapshotWrite, snapMs } from '@/lib/snapshot';

import { CATEGORIES, catName } from '@/lib/categories';
import { useLang, type Lang } from '@/lib/i18n';

// Round 114: trilingual AR/FR/EN (js/i18n.js + js/alerts.js parity) —
// user-facing strings now come from the shared i18n store via useLang().
// Category names use the shared trilingual CATEGORIES (js/categories.js).

function wilayaName(code: number | null | undefined, lang: Lang = 'ar'): string {
  if (code == null) return '';
  const w = WILAYAS.find((x) => x.code === code);
  return w ? `${w.code} - ${w[lang] || w.ar}` : String(code);
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

// Round 114: follows the UI language (trilingual parity).
function localizedTitle(title: unknown, lang: Lang = 'ar'): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  if (typeof title === 'object') {
    const o = title as Record<string, string>;
    return o[lang] || o.ar || o.fr || o.en || '';
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
    // 11 Oct 2026: search ALL language variants (was Arabic-only — FR/EN broken).
    const titles = typeof l.title === 'object' && l.title
      ? Object.values(l.title as Record<string, string>)
      : [localizedTitle(l.title)];
    const hay = titles.map((t) => normAr(t)).join(' ');
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every((tk) => hay.includes(tk))) return false;
  }
  return true;
}

// 0.0.0.22 (Zak): instant paint — last alerts render from localStorage,
// before the SDKs/auth/network. Silently refreshed by loadAll().
// Returns { searches, matches, notifs } or null.
function paintAlertsSnapshot(): {
  searches: SavedSearch[];
  matches: { search: SavedSearch; hits: FreshListing[] }[];
  notifs: Notif[];
} | null {
  const snap = snapshotRead<{
    searches?: SavedSearch[];
    listings?: FreshListing[];
    notifs?: Notif[];
  }>('alerts');
  if (!snap || !snap.data) return null;
  try {
    const searches = Array.isArray(snap.data.searches) ? snap.data.searches : [];
    const listings = Array.isArray(snap.data.listings) ? snap.data.listings : [];
    const notifs = Array.isArray(snap.data.notifs) ? snap.data.notifs : [];
    if (!searches.length && !notifs.length) return null;
    // Recompute matches from cached searches + listings (legacy
    // buildMatchesHtml parity — matches are derived, not stored).
    const active = searches.filter((s) => s && s.enabled);
    const matches: { search: SavedSearch; hits: FreshListing[] }[] = [];
    for (const s of active) {
      const hits = listings.filter((l) => l && matchesSavedSearch(l, s)).slice(0, 6);
      if (hits.length) matches.push({ search: s, hits });
    }
    return { searches, matches, notifs };
  } catch {
    return null;
  }
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

function notifTitle(n: Notif, t: (k: string) => string, lang: Lang = 'ar'): string {
  if (n.type === 'follow') {
    return t('followedYou').replace(
      '{name}',
      String((n.data && n.data.followerName) || '')
    );
  }
  // 0.0.0.31 D-2: price_drop renders from the i18n template at READ time
  // (placeholders from n.data) — legacy's writer stores title:''.
  if (n.type === 'price_drop') {
    const d = n.data || {};
    const str = (v: unknown) => String(v == null ? '' : v);
    // 11 Oct 2026: pass lang — prices were always rendering in Arabic.
    return t('notifPriceDrop')
      .split('{title}')
      .join(str(d.title))
      .split('{oldPrice}')
      .join(formatPrice(Number(d.oldPrice) || 0, lang))
      .split('{newPrice}')
      .join(formatPrice(Number(d.newPrice) || 0, lang));
  }
  // 11 Oct 2026: message/new_message — legacy writer stores title:''.
  // Construct from sender name in data, fallback to non-empty.
  if (n.type === 'message' || n.type === 'new_message') {
    const d = (n.data || {}) as Record<string, unknown>;
    const sender = String(d.senderName || d.sender || '');
    if (sender) return sender;
    // Fallback: use non-empty title so the UI never shows blank.
    return t('newMessage');
  }
  // 11 Oct 2026: 4 missing templates — were falling back to "new message".
  const d = (n.data || {}) as Record<string, unknown>;
  const str = (v: unknown) => String(v == null ? '' : v);
  if (n.type === 'saved_search_match') {
    return t('notifSavedSearchMatch')
      .split('{title}').join(str(d.title))
      .split('{price}').join(formatPrice(Number(d.price) || 0, lang))
      .split('{wilaya}').join(str(d.wilaya));
  }
  if (n.type === 'new_favorite') {
    return t('notifNewFavorite').split('{title}').join(str(d.title));
  }
  if (n.type === 'phone_request') {
    return t('notifPhoneRequest').split('{listingTitle}').join(str(d.listingTitle));
  }
  if (n.type === 'deal_confirmed') {
    return t('notifDealConfirmed').split('{name}').join(str(d.name));
  }
  // 11 Oct 2026: Final fallback — NEVER return blank.
  // Some legacy notifications have empty title and unhandled type.
  const title = n.title || '';
  if (title) return title;
  // Last resort: newMessage is better than blank for any notification.
  return t('newMessage');
}

function searchMeta(s: SavedSearch, lang: Lang): string {
  const bits: string[] = [];
  if (s.categoryId) bits.push(catName(s.categoryId, lang));
  if (s.wilayaCode != null) bits.push(wilayaName(s.wilayaCode, lang));
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
  const { t, lang } = useLang();
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
  // 11 Oct 2026: custom delete confirmation modal (window.confirm hangs automation)
  const [deleteConfirm, setDeleteConfirm] = useState<SavedSearch | null>(null);
  // 12 Oct 2026: in-flight guard for delete (prevents double-click).
  const [deleting, setDeleting] = useState(false);
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
      const { db, fsMod } = client;
      // NOTE: loading/error are NOT set synchronously here — the initial
      // useState(true) covers first paint, and retry buttons set them in
      // their (allowed) event handlers. All setState below happens in
      // async continuations (after await).
      try {
        // Saved searches
        const sSnap = await fsMod.getDocs(
          fsMod.collection(db, `users/${user.uid}/savedSearches`)
        );
        const docs: SavedSearch[] = sSnap.docs.map((d) => ({
          id: d.id,
          ...((d.data() || {}) as object),
        })) as SavedSearch[];
        setSearches(docs);

        // Fresh listings for matching
        const active = docs.filter((s) => s.enabled);
        const matchGroups: { search: SavedSearch; hits: FreshListing[] }[] = [];
        let freshForSnap: FreshListing[] = [];
        if (active.length) {
          const lSnap = await fsMod
            .getDocs(
              fsMod.query(
                fsMod.collection(db, 'listings'),
                fsMod.where('status', 'in', ['available', 'negotiating']),
                fsMod.orderBy('createdAt', 'desc'),
                fsMod.limit(60)
              )
            )
            .catch(() =>
              // No composite index: unordered fallback, client-sorted
              fsMod.getDocs(
                fsMod.query(fsMod.collection(db, 'listings'), fsMod.limit(60))
              )
            );
          const fresh: FreshListing[] = lSnap.docs.map(
            (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as FreshListing
          );
          freshForSnap = fresh;
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
        const nSnap = await fsMod
          .getDocs(
            fsMod.query(
              fsMod.collection(db, `users/${user.uid}/notifications`),
              fsMod.orderBy('createdAt', 'desc'),
              fsMod.limit(30)
            )
          )
          .catch(() =>
            fsMod.getDocs(
              fsMod.query(
                fsMod.collection(db, `users/${user.uid}/notifications`),
                fsMod.limit(30)
              )
            )
          );
        const nDocs: Notif[] = nSnap.docs
          .map(
            (d) => ({ id: d.id, ...((d.data() || {}) as object) }) as Notif
          )
          .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
        setNotifs(nDocs);
        // 0.0.0.22 (Zak): save for instant paint on next boot. Listing
        // projection covers the match cards; notif projection covers the
        // inbox render.
        try {
          snapshotWrite('alerts', user.uid, {
            searches: docs.map((s) => ({
              id: s.id,
              query: s.query || '',
              enabled: !!s.enabled,
              categoryId: s.categoryId || '',
              wilayaCode: s.wilayaCode,
              minPrice: s.minPrice,
              maxPrice: s.maxPrice,
            })),
            listings: freshForSnap.map((l) => {
              const lr = l as FreshListing & Record<string, unknown>;
              return {
                id: l.id,
                title: l.title || '',
                price: l.price || 0,
                photoUrls: (l.photoUrls || []).slice(0, 2),
                thumbUrls: ((l.photo_thumbs && l.photo_thumbs.length ? l.photo_thumbs : l.thumbUrls) || []).slice(0, 2),
                status: String(lr.status || ''),
                categoryId: l.categoryId || '',
                wilayaCode: l.wilayaCode || 0,
                createdAt: snapMs(l.createdAt),
                previousPrice: Number(lr.previousPrice || 0),
                priceReduced: !!lr.priceReduced,
                sellerId: String(lr.sellerId || ''),
                isWholesale: !!lr.isWholesale,
                isWanted: !!l.isWanted,
              };
            }),
            notifs: nDocs.map((n) => {
              const nd = (n.data || {}) as Record<string, unknown>;
              return {
                id: n.id,
                type: n.type || '',
                title: n.title || '',
                body: n.body || '',
                read: !!n.read,
                createdAt: snapMs(n.createdAt),
                data: {
                  conversationId: String(nd.conversationId || ''),
                  listingId: String(nd.listingId || ''),
                  followerUid: String(nd.followerUid || ''),
                  followerName: String(nd.followerName || ''),
                  title: String(nd.title || ''),
                  listingTitle: String(nd.listingTitle || nd.title || ''),
                  senderName: String(nd.senderName || ''),
                  price: Number(nd.price || 0),
                  oldPrice: Number(nd.oldPrice || 0),
                  newPrice: Number(nd.newPrice || 0),
                  wilaya: String(nd.wilayaName || nd.wilaya || ''),
                },
              };
            }),
          });
        } catch {
          /* best-effort */
        }
      } catch {
        setError(t('errorGeneric'));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (authState.status !== 'signed-in') return;
    clientRef.current = authState.client;
    userRef.current = authState.user;
    /* eslint-disable react-hooks/set-state-in-effect -- 0.0.0.22 instant paint: synchronous snapshot paint on mount, guarded */
    // 0.0.0.22 (Zak): paint the last good render synchronously, before the
    // SDKs/network. loadAll() then refreshes silently in the background.
    try {
      const cached = paintAlertsSnapshot();
      if (cached) {
        setSearches(cached.searches);
        setMatches(cached.matches);
        setNotifs(cached.notifs);
        setLoading(false);
      }
    } catch {
      /* fall through to the live path */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Data-fetch effect: loadAll is async and only sets state in async
    // continuations (after await). No synchronous setState — the
    // cascading-render concern does not apply.
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
      showToast(t('searchNeedsCriteria'));
      return;
    }
    setSaving(true);
    try {
      // 11 Oct 2026: auto-swap min/max — reversed range never matches.
      let minP = fMin === '' ? null : Number(fMin);
      let maxP = fMax === '' ? null : Number(fMax);
      if (minP !== null && maxP !== null && minP > maxP) {
        [minP, maxP] = [maxP, minP];
      }
      const payload = {
        query: fQ.trim(),
        categoryId: fCat || '',
        wilayaCode: fWilaya === '' ? null : Number(fWilaya),
        minPrice: minP,
        maxPrice: maxP,
      };
      const { db, fsMod } = client;
      const col = fsMod.collection(db, `users/${user.uid}/savedSearches`);
      if (editingId) {
        await fsMod.updateDoc(fsMod.doc(col, editingId), payload);
        showToast(t('searchUpdated'));
        resetForm();
      } else {
        const existing = await fsMod.getDocs(col);
        if (existing.size >= 10) {
          showToast(t('maxSearchesReached'));
          setSaving(false);
          return;
        }
        await fsMod.addDoc(col, {
          userId: user.uid,
          ...payload,
          enabled: true,
          createdAt: fsMod.serverTimestamp(),
        });
        resetForm();
      }
      await loadAll(client, user);
    } catch {
      showToast(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSearch(s: SavedSearch) {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    try {
      const { db, fsMod } = client;
      await fsMod.updateDoc(
        fsMod.doc(db, `users/${user.uid}/savedSearches`, s.id),
        { enabled: !s.enabled }
      );
      await loadAll(client, user);
    } catch {
      showToast(t('errorGeneric'));
    }
  }

  async function deleteSearch(s: SavedSearch) {
    // 11 Oct 2026: use custom modal instead of window.confirm (hangs automation)
    setDeleteConfirm(s);
  }

  async function confirmDeleteSearch() {
    const s = deleteConfirm;
    if (!s || deleting) return;
    setDeleteConfirm(null);
    setDeleting(true);
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) {
      setDeleting(false);
      return;
    }
    if (s.id === editingId) resetForm();
    try {
      const { db, fsMod } = client;
      await fsMod.deleteDoc(
        fsMod.doc(db, `users/${user.uid}/savedSearches`, s.id)
      );
      await loadAll(client, user);
    } catch {
      showToast(t('errorGeneric'));
    } finally {
      setDeleting(false);
    }
  }

  async function markAllRead() {
    const client = clientRef.current;
    const user = userRef.current;
    if (!client || !user) return;
    const unread = notifs.filter((n) => !n.read);
    if (!unread.length) return;
    try {
      const { db, fsMod } = client;
      const batch = fsMod.writeBatch(db);
      const col = fsMod.collection(db, `users/${user.uid}/notifications`);
      unread.forEach((n) => batch.update(fsMod.doc(col, n.id), { read: true }));
      await batch.commit();
      await loadAll(client, user);
      // 12 Oct 2026: notify SiteChrome to refresh badge (was stale until reload).
      window.dispatchEvent(new CustomEvent('dlala:alerts-read'));
    } catch {
      showToast(t('errorGeneric'));
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
        const { db, fsMod } = client;
        await fsMod.updateDoc(
          fsMod.doc(db, `users/${user.uid}/notifications`, n.id),
          { read: true }
        );
      } catch {
        /* best-effort — still navigate */
      }
    }
    router.push(target);
  }

  if (authState.status !== 'signed-in') {
    return <LoadingSpinner label={t('loading')} />;
  }

  const hasUnread = notifs.some((n) => !n.read);

  return (
    <div className="min-h-screen bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-5">
          🔔 {t('alerts')}
        </h1>

        {loading && (
          <div className="text-center py-10">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-emerald-200 border-t-emerald-700" />
            <p className="mt-4 text-zinc-600">{t('loading')}</p>
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
              {t('retry')}
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <h2 className="font-bold text-zinc-900 mt-2 mb-3">
              {t('newMatches')}
            </h2>
            <div className="space-y-4">
              {matches.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  {searches.filter((s) => s.enabled).length === 0
                    ? t('noSavedSearches')
                    : t('noNewMatches')}
                </div>
              )}
              {matches.map(({ search, hits }) => (
                <div key={search.id}>
                  <h3 className="text-sm font-bold text-zinc-700 my-2">
                    🔎 {search.query || searchMeta(search, lang) || '—'}
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
                            {/* 11 Oct 2026: removed unoptimized — AVIF/WebP for weak internet. */}
                            <Image
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
                            {localizedTitle(h.title, lang)}
                          </div>
                          <div className="text-sm font-bold text-emerald-700">
                            {formatPrice(h.price || 0, lang)}
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
              {t('notificationsTitle')}
            </h2>
            <div className="mb-3">
              <button
                className={btnSecondaryCls}
                onClick={markAllRead}
                disabled={!hasUnread}
              >
                {t('markAllRead')}
              </button>
            </div>
            <div className="space-y-2">
              {notifs.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  📭 {t('noNotifications')}
                </div>
              )}
              {notifs.map((n) => {
                const target = notifTarget(n);
                const inner = (
                  <>
                    <div className="font-bold text-zinc-900 text-sm">
                      {notifTitle(n, t, lang)}
                    </div>
                    {n.body && (
                      <div className="text-sm text-zinc-600">{n.body}</div>
                    )}
                    <div className="text-xs text-zinc-400 mt-1">
                      {timeAgo(
                        tsMs(n.createdAt)
                          ? new Date(tsMs(n.createdAt))
                          : undefined,
                        lang
                      )}
                    </div>
                  </>
                );
                const cls = `rounded-xl shadow-sm p-3 bg-white ${n.read ? '' : 'border-s-4 border-s-emerald-600'}`;
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
              {t('savedSearches')}
            </h2>
            <div className="space-y-2">
              {searches.length === 0 && (
                <div className="rounded-xl bg-white shadow-sm p-6 text-center text-sm text-zinc-500">
                  🔔 {t('noSavedSearches')}
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
                      {s.enabled ? t('searchEnabled') : t('searchDisabled')}
                    </span>
                  </div>
                  {searchMeta(s, lang) && (
                    <div className="text-xs text-zinc-500 mt-1">
                      {searchMeta(s, lang)}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm'}
                      onClick={() => toggleSearch(s)}
                    >
                      {s.enabled ? t('disableSearch') : t('enableSearch')}
                    </button>
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm'}
                      onClick={() => startEdit(s)}
                    >
                      {t('editSearch')}
                    </button>
                    <button
                      className={btnSecondaryCls + ' !py-1.5 !px-3 text-sm !text-red-600'}
                      onClick={() => deleteSearch(s)}
                    >
                      {t('delete')}
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
                {t('newSavedSearch')}
              </h3>
              <label
                htmlFor="sQ"
                className="block text-sm font-medium text-zinc-700 mb-1"
              >
                {t('searchKeyword')}
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
                    {t('searchCategory')}
                  </label>
                  <select
                    id="sCat"
                    className={inputCls}
                    value={fCat}
                    onChange={(e) => setFCat(e.target.value)}
                  >
                    <option value="">{t('allCategories')}</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c[lang] || c.ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sWilaya"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {t('searchWilaya')}
                  </label>
                  <select
                    id="sWilaya"
                    className={inputCls}
                    value={fWilaya}
                    onChange={(e) => setFWilaya(e.target.value)}
                  >
                    <option value="">{t('allWilayas')}</option>
                    {WILAYAS.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w[lang] || w.ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sMin"
                    className="block text-sm font-medium text-zinc-700 mb-1"
                  >
                    {t('searchMinPrice')}
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
                    {t('searchMaxPrice')}
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
                  {editingId ? t('updateSearch') : t('createSearch')}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className={btnSecondaryCls}
                    onClick={resetForm}
                  >
                    {t('cancelEdit')}
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

      {/* 11 Oct 2026: custom delete confirmation modal (replaces window.confirm) */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900 mb-2">
              {t('delete')}
            </h3>
            <p className="text-zinc-600 text-sm mb-6">
              {t('deleteSearchConfirm')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className={btnSecondaryCls}
                onClick={() => setDeleteConfirm(null)}
              >
                {t('cancel')}
              </button>
              <button
                className="px-4 py-2 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                onClick={confirmDeleteSearch}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
