// Account page — profile editing + verified-store editor.
//
// Migrated from account.html + js/account.js (production 0.0.0.43).
// Auth-gated: redirects to /auth when signed out.
//
// Behavior preserved:
// - Email-verification banner for unverified users
// - Profile form: avatar photo, name (Latin), username (unique), bio
// - Validation: Latin name 2-40, username 3-20 [a-z0-9._], bio ≤300
// - Username change: atomic batch (registry create + profile update +
//   old registry delete)
// - Avatar upload to profiles/{uid}/ with EXIF strip note, orphan cleanup
//   on write failure, old avatar deletion on success
// - "Create profile" for accounts with no users/{uid} doc
// - My Store editor (visible only for storeTier == 'verified'):
//   cover + logo upload, store name (≤60), bio (≤500), orphan cleanup

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import { getFirebase, withTimeout, type CompatUser } from '@/lib/firebase-compat';
import { stripExif } from '@/lib/stripExif';
import { useLang } from '@/lib/i18n';
import { snapshotRead, snapshotWrite } from '@/lib/snapshot';

interface ProfileData {
  name?: string;
  username?: string;
  bio?: string;
  photoPath?: string;
  storeTier?: string;
  storeName?: string;
  storeBio?: string;
  storeCoverUrl?: string;
  storeLogoUrl?: string;
}

type ProfileState = 'loading' | 'error' | 'empty' | 'ready';

// 0.0.0.22 (Zak): instant paint — last profile from localStorage, before the
// SDKs/auth/network. Silently refreshed by loadProfile().
function paintProfileSnapshot(): ProfileData | null {
  const snap = snapshotRead<ProfileData>('profile');
  if (!snap || !snap.data) return null;
  try {
    const d = snap.data;
    if (!d || typeof d !== 'object') return null;
    return {
      name: d.name || '',
      username: d.username || '',
      bio: d.bio || '',
      photoPath: d.photoPath || '',
    };
  } catch {
    return null;
  }
}

type DbLike = {
  doc: (p: string) => {
    get: () => Promise<{ exists: boolean; data: () => ProfileData }>;
    update: (d: Record<string, unknown>) => Promise<void>;
    set: (d: Record<string, unknown>) => Promise<void>;
    delete: () => Promise<void>;
  };
  batch: () => {
    set: (ref: unknown, d: Record<string, unknown>) => void;
    update: (ref: unknown, d: Record<string, unknown>) => void;
    delete: (ref: unknown) => void;
    commit: () => Promise<void>;
  };
};

type StorageLike = {
  ref: (p: string) => {
    put: (f: Blob) => Promise<{ ref: { getDownloadURL: () => Promise<string> } }>;
    delete: () => Promise<void>;
  };
};

export default function AccountPage() {
  return (
    <AuthGate>
      {(user) => <AccountContent user={user} />}
    </AuthGate>
  );
}

function AccountContent({ user }: { user: CompatUser }) {
  const { lang, t } = useLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [state, setState] = useState<ProfileState>('loading');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [profData, setProfData] = useState<ProfileData | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profErr, setProfErr] = useState<string | null>(null);
  const [profOk, setProfOk] = useState(false);
  const [profBusy, setProfBusy] = useState(false);
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showVerifyBanner] = useState(() => !user.emailVerified);
  // Store editor
  const [storeName, setStoreName] = useState('');
  const [storeBio, setStoreBio] = useState('');
  const [storeErr, setStoreErr] = useState<string | null>(null);
  const [storeOk, setStoreOk] = useState(false);
  const [storeBusy, setStoreBusy] = useState(false);
  const [newCoverFile, setNewCoverFile] = useState<File | null>(null);
  const [newLogoFile, setNewLogoFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);

  const isPro = !!(profData && profData.storeTier === 'verified');

  // ---- Avatar preview (created at selection time, revoked on replace/unmount) --
  const previewUrls = useRef<string[]>([]);
  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);
  const makePreview = useCallback((f: File | null, setPreview: (u: string | null) => void) => {
    if (!f) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(f);
    previewUrls.current.push(url);
    setPreview(url);
  }, []);

  // ---- Load profile ----------------------------------------------------------
  const loadProfile = useCallback(async () => {
    // 0.0.0.22 (Zak): a snapshot already painted stays — refresh silently.
    // Check synchronously before any await.
    let paintedFromCache = false;
    try {
      const cached = paintProfileSnapshot();
      if (cached && mounted.current) {
        setProfData(cached);
        setName(cached.name || '');
        setUsername(cached.username || '');
        setBio(cached.bio || '');
        setState('ready');
        paintedFromCache = true;
      }
    } catch {
      /* fall through to the live path */
    }
    if (!paintedFromCache) {
      setState('loading');
    }
    setLoadErr(null);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike;
      const d = await withTimeout(db.doc('users/' + user.uid).get(), 20000);
      if (!mounted.current) return;
      if (!d.exists) {
        setState('empty');
        return;
      }
      const raw = d.data() || {};
      setProfData(raw);
      setName(raw.name || '');
      setUsername(raw.username || '');
      setBio(raw.bio || '');
      setStoreName(raw.storeName || '');
      setStoreBio(raw.storeBio || '');
      setState('ready');
      // 0.0.0.22 (Zak): save for instant paint on next boot.
      try {
        snapshotWrite('profile', user.uid, {
          name: raw.name || '',
          username: raw.username || '',
          bio: raw.bio || '',
          photoPath: raw.photoPath || '',
        });
      } catch {
        /* best-effort */
      }
    } catch (e) {
      console.error(e);
      if (!mounted.current) return;
      // If snapshot was painted, keep it on error (silent refresh failed).
      if (!paintedFromCache) {
        setLoadErr(t('errorGeneric'));
        setState('error');
      }
    }
  }, [user.uid, t]);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount, guarded by mounted ref */
  useEffect(() => {
    mounted.current = true;
    loadProfile();
    return () => {
      mounted.current = false;
    };
  }, [user, loadProfile]);

  const avatarUrl = (): string => {
    if (photoPreview) return photoPreview;
    const p = String(profData?.photoPath || '');
    if (/^https:\/\//i.test(p)) return p;
    return '';
  };

  // ---- Create profile (missing doc) -------------------------------------------
  const createProfile = useCallback(async () => {
    setProfBusy(true);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike & {
        doc: (p: string) => { get: () => Promise<{ exists: boolean }> };
      };
      // Derive a unique username (mirrors js/app.js claimUniqueUsername).
      const base = (user.displayName || (user.email || '').split('@')[0] || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .slice(0, 20) || 'user';
      let candidate = base;
      for (let i = 0; i < 10; i++) {
        const reg = await withTimeout(db.doc('usernames/' + candidate).get(), 15000).catch(() => null);
        if (!reg || !reg.exists) break;
        candidate = (base + Math.floor(Math.random() * 9000 + 1000)).slice(0, 20);
      }
      const displayName = (user.displayName || candidate).slice(0, 40);
      const batch = db.batch();
      const userRef = db.doc('users/' + user.uid);
      batch.set(userRef, {
        name: displayName,
        username: candidate,
        verified: false,
        isAdmin: false,
        emailVerified: false,
        rating: 0,
        ratingCount: 0,
        confirmedDeals: 0,
        boostCredits: 0,
        phone: '',
        termsAcceptedAt: (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue.serverTimestamp(),
        createdAt: (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue.serverTimestamp(),
      });
      batch.set(db.doc('usernames/' + candidate), { userId: user.uid });
      await withTimeout(batch.commit(), 20000);
      loadProfile();
    } catch (e) {
      console.error(e);
      if (mounted.current) {
        setLoadErr(t('errorGeneric'));
        setState('error');
      }
    } finally {
      if (mounted.current) setProfBusy(false);
    }
  }, [user, t, loadProfile]);

  // ---- Save profile -------------------------------------------------------------
  const saveProfile = useCallback(async () => {
    const n = name.trim();
    const u = username.trim().toLowerCase();
    const b = bio.trim();
    if (!/^[A-Za-z][A-Za-z .'-]{1,38}$/.test(n)) {
      setProfErr(t('invalidName'));
      return;
    }
    if (!/^[a-z0-9._]{3,20}$/.test(u)) {
      setProfErr(t('invalidUsername'));
      return;
    }
    if (b.length > 300) {
      setProfErr(t('bioTooLong'));
      return;
    }
    setProfErr(null);
    setProfOk(false);
    setProfBusy(true);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike;
      const storage = fb.storage() as unknown as StorageLike;
      const old = profData || {};
      const oldUsername = old.username || '';
      const oldPhotoPath = old.photoPath || '';
      const usernameChanged = u !== oldUsername;

      if (usernameChanged) {
        const reg = await withTimeout(db.doc('usernames/' + u).get(), 20000);
        if (reg.exists) {
          setProfErr(t('usernameTaken'));
          setProfBusy(false);
          return;
        }
      }

      let photoPath = oldPhotoPath;
      if (newPhotoFile) {
        if (newPhotoFile.size > 5 * 1024 * 1024) {
          setProfErr(t('photoTooBig'));
          setProfBusy(false);
          return;
        }
        // Strip EXIF (incl. GPS) before upload — avatars are public.
        let safePhoto: File;
        try {
          safePhoto = await withTimeout(stripExif(newPhotoFile), 30000);
        } catch {
          // A processing failure is not a size problem — do not tell the
          // user "photo too big" when it isn't.
          setProfErr(t('errorPhoto'));
          setProfBusy(false);
          return;
        }
        const path = `profiles/${user.uid}/avatar_${Date.now()}.jpg`;
        const snap = await withTimeout(storage.ref(path).put(safePhoto), 30000);
        photoPath = await withTimeout(snap.ref.getDownloadURL(), 15000);
      }

      const update = {
        name: n,
        username: u,
        bio: b,
        photoPath: photoPath || '',
        lastSeenAt: (fb.firestore as unknown as { FieldValue: { serverTimestamp: () => unknown } }).FieldValue.serverTimestamp(),
      };
      // If the write fails AFTER the new avatar uploaded, delete the new
      // upload so no orphaned Storage object is left behind.
      const delNewAvatar = async () => {
        if (newPhotoFile && photoPath && photoPath !== oldPhotoPath && /^https:\/\//i.test(photoPath)) {
          try {
            await storage.ref(photoPath).delete();
          } catch {
            // ignore
          }
        }
      };
      try {
        if (usernameChanged) {
          const batch = db.batch();
          batch.set(db.doc('usernames/' + u), { userId: user.uid });
          batch.update(db.doc('users/' + user.uid), update);
          if (oldUsername) batch.delete(db.doc('usernames/' + oldUsername));
          await withTimeout(batch.commit(), 20000);
        } else {
          await withTimeout(db.doc('users/' + user.uid).update(update), 20000);
        }
      } catch (e) {
        await delNewAvatar();
        throw e;
      }
      // Best-effort: remove the orphaned old avatar.
      if (newPhotoFile && oldPhotoPath && oldPhotoPath !== photoPath && /^https:\/\//i.test(oldPhotoPath)) {
        try {
          await storage.ref(oldPhotoPath).delete();
        } catch {
          // keep going
        }
      }
      setNewPhotoFile(null);
      setProfData({ ...old, ...update });
      setProfOk(true);
    } catch (e) {
      console.error(e);
      // 11 Oct 2026: removed temporary [code] suffix — was debug aid.
      if (mounted.current) setProfErr(t('errorGeneric'));
    } finally {
      if (mounted.current) setProfBusy(false);
    }
  }, [user.uid, name, username, bio, newPhotoFile, profData, t]);

  // ---- Store editor --------------------------------------------------------------
  const uploadStoreImage = useCallback(
    async (file: File, kind: string): Promise<string> => {
      if (file.size > 5 * 1024 * 1024) throw new Error('photoTooBig');
      // Strip EXIF (incl. GPS) — store images are public.
      let safe: File;
      try {
        safe = await withTimeout(stripExif(file), 30000);
      } catch {
        throw new Error('errorPhoto');
      }
      const fb = await getFirebase();
      const storage = fb.storage() as unknown as StorageLike;
      const path = `profiles/${user.uid}/store-${kind}_${Date.now()}.jpg`;
      const snap = await withTimeout(storage.ref(path).put(safe), 30000);
      return withTimeout(snap.ref.getDownloadURL(), 15000);
    },
    [user.uid]
  );

  const saveStore = useCallback(async () => {
    const sn = storeName.trim();
    const sb = storeBio.trim();
    if (sn.length > 60) {
      setStoreErr(t('storeNameTooLong'));
      return;
    }
    if (sb.length > 500) {
      setStoreErr(t('storeBioTooLong'));
      return;
    }
    setStoreErr(null);
    setStoreOk(false);
    setStoreBusy(true);
    try {
      const fb = await getFirebase();
      const db = fb.firestore() as unknown as DbLike;
      const storage = fb.storage() as unknown as StorageLike;
      const old = profData || {};
      let coverUrl = old.storeCoverUrl || '';
      let logoUrl = old.storeLogoUrl || '';
      if (newCoverFile) {
        try {
          coverUrl = await uploadStoreImage(newCoverFile, 'cover');
        } catch (e) {
          setStoreErr(t((e as Error).message === 'photoTooBig' ? 'photoTooBig' : 'errorPhoto'));
          setStoreBusy(false);
          return;
        }
      }
      if (newLogoFile) {
        try {
          logoUrl = await uploadStoreImage(newLogoFile, 'logo');
        } catch (e) {
          setStoreErr(t((e as Error).message === 'photoTooBig' ? 'photoTooBig' : 'errorPhoto'));
          setStoreBusy(false);
          return;
        }
      }
      const update = { storeName: sn, storeBio: sb, storeCoverUrl: coverUrl, storeLogoUrl: logoUrl };
      const delNew = async () => {
        const pairs: [File | null, string, string][] = [
          [newCoverFile, old.storeCoverUrl || '', coverUrl],
          [newLogoFile, old.storeLogoUrl || '', logoUrl],
        ];
        for (const [f, oldUrl, nu] of pairs) {
          if (f && nu && nu !== oldUrl && /^https:\/\//i.test(nu)) {
            try {
              await storage.ref(nu).delete();
            } catch {
              // ignore
            }
          }
        }
      };
      try {
        await withTimeout(db.doc('users/' + user.uid).update(update), 20000);
      } catch (e) {
        await delNew();
        throw e;
      }
      // Best-effort: remove orphaned old images.
      const pairs: [File | null, string, string][] = [
        [newCoverFile, old.storeCoverUrl || '', coverUrl],
        [newLogoFile, old.storeLogoUrl || '', logoUrl],
      ];
      for (const [f, oldUrl, nu] of pairs) {
        if (f && oldUrl && oldUrl !== nu && /^https:\/\//i.test(oldUrl)) {
          try {
            await storage.ref(oldUrl).delete();
          } catch {
            // keep going
          }
        }
      }
      setNewCoverFile(null);
      setNewLogoFile(null);
      setProfData({ ...old, ...update });
      setStoreOk(true);
    } catch (e) {
      console.error(e);
      if (mounted.current) setStoreErr(t('errorGeneric'));
    } finally {
      if (mounted.current) setStoreBusy(false);
    }
  }, [user.uid, storeName, storeBio, newCoverFile, newLogoFile, profData, t, uploadStoreImage]);

  const pickFile = useCallback(
    (kind: 'photo' | 'cover' | 'logo', f: File | undefined) => {
      if (!f) return;
      if (!f.type.startsWith('image/')) {
        // 11 Oct 2026: inline error — window.alert hangs headless browsers.
        setProfErr(t('errorPhoto'));
        return;
      }
      if (f.size > 5 * 1024 * 1024) {
        setProfErr(t('photoTooBig'));
        return;
      }
      if (kind === 'photo') {
        setNewPhotoFile(f);
        makePreview(f, setPhotoPreview);
      } else if (kind === 'cover') {
        setNewCoverFile(f);
        makePreview(f, setCoverPreview);
      } else {
        setNewLogoFile(f);
        makePreview(f, setLogoPreview);
      }
    },
    [t, makePreview]
  );

  const resendVerification = useCallback(async () => {
    try {
      await withTimeout(user.sendEmailVerification(), 15000);
      // 11 Oct 2026: inline — window.alert hangs headless browsers.
      setProfErr(t('verifyEmailBody'));
    } catch {
      setProfErr(t('authConnectionProblem'));
    }
  }, [user, t]);

  const iVerified = useCallback(async () => {
    try {
      await withTimeout(user.reload(), 15000);
    } catch {
      setProfErr(t('authConnectionProblem'));
      return;
    }
    const fb = await getFirebase().catch(() => null);
    const cu = fb?.auth().currentUser;
    if (cu && cu.emailVerified) window.location.reload();
    else setProfErr(t('stillNotVerified'));
  }, [user, t]);

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base';
  const btnCls =
    'rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors';
  const btnSecCls =
    'rounded-lg bg-white border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50';

  const avUrl = avatarUrl();
  const coverUrl = coverPreview || (/^https:\/\//i.test(String(profData?.storeCoverUrl || '')) ? String(profData?.storeCoverUrl) : '');
  const logoUrl = logoPreview || (/^https:\/\//i.test(String(profData?.storeLogoUrl || '')) ? String(profData?.storeLogoUrl) : '');

  return (
    <div className="min-h-screen bg-zinc-50" dir={dir}>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {showVerifyBanner && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
            <p className="text-sm text-blue-900">{t('verifyEmailBody')}</p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button onClick={iVerified} className={btnCls + ' text-sm'}>
                {t('iVerifiedContinue')}
              </button>
              <button onClick={resendVerification} className={btnSecCls}>
                {t('resendEmail')}
              </button>
            </div>
          </div>
        )}

        {/* Profile */}
        <section className="rounded-xl bg-white shadow-sm p-6">
          <h2 className="text-lg font-bold text-zinc-900 mb-1">{t('account')}</h2>
          <h3 className="text-sm font-medium text-zinc-600 mb-4">{t('editProfile')}</h3>

          {state === 'loading' && (
            <div className="text-center py-8">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
              <p className="mt-3 text-zinc-600 text-sm">{t('loading')}</p>
            </div>
          )}

          {state === 'error' && (
            <div>
              <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
                {loadErr}
              </p>
              <button onClick={loadProfile} className={btnSecCls}>
                {t('retry')}
              </button>
            </div>
          )}

          {state === 'empty' && (
            <div>
              <p className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900 mb-3">
                {t('profileMissing')}
              </p>
              <button onClick={createProfile} disabled={profBusy} className={btnCls + ' text-sm'}>
                {profBusy ? '…' : t('createProfile')}
              </button>
            </div>
          )}

          {state === 'ready' && (
            <div>
              {profErr && (
                <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
                  {profErr}
                </p>
              )}
              {profOk && (
                <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 mb-3">
                  {t('profileSaved')}
                </p>
              )}

              <div className="flex items-center gap-4 my-4">
                {avUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avUrl} alt="" className="w-20 h-20 rounded-full object-cover bg-zinc-100" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold">
                    {(name?.[0] || '?').toUpperCase()}
                  </div>
                )}
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => pickFile('photo', e.target.files?.[0])}
                  />
                  <button onClick={() => fileRef.current?.click()} className={btnSecCls} type="button">
                    {t('changePhoto')}
                  </button>
                </div>
              </div>

              <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="profName">
                {t('name')}
              </label>
              <input
                id="profName"
                dir="ltr"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls + ' mb-4 text-left'}
              />

              <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="profUsername">
                {t('username')}
              </label>
              <input
                id="profUsername"
                dir="ltr"
                maxLength={20}
                placeholder={t('usernameEx')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls + ' mb-4 text-left'}
              />

              <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="profBio">
                {t('bio')}
              </label>
              <textarea
                id="profBio"
                maxLength={300}
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className={inputCls + ' mb-4'}
              />

              <button onClick={saveProfile} disabled={profBusy} className={btnCls}>
                {profBusy ? '…' : t('saveProfile')}
              </button>
            </div>
          )}
        </section>

        {/* Store editor (verified stores only) */}
        {state === 'ready' && isPro && (
          <section className="rounded-xl bg-white shadow-sm p-6">
            <h2 className="text-lg font-bold text-zinc-900 mb-4">🏬 {t('myStore')}</h2>
            {storeErr && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">
                {storeErr}
              </p>
            )}
            {storeOk && (
              <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 mb-3">
                {t('profileSaved')}
              </p>
            )}

            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeCoverLabel')}</label>
            <div className="rounded-lg bg-zinc-100 h-28 mb-2 overflow-hidden flex items-center justify-center text-zinc-400 text-sm">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{t('storeCoverLabel')}</span>
              )}
            </div>
            <input
              ref={coverFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => pickFile('cover', e.target.files?.[0])}
            />
            <button onClick={() => coverFileRef.current?.click()} className={btnSecCls + ' mb-4'} type="button">
              {t('changePhoto')}
            </button>

            <label className="block text-sm font-medium text-zinc-700 mb-1">{t('storeLogoLabel')}</label>
            <div className="flex items-center gap-4 mb-4">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="w-20 h-20 rounded-full object-cover bg-zinc-100" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl font-bold">
                  {((storeName || name)?.[0] || '?').toUpperCase()}
                </div>
              )}
              <input
                ref={logoFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => pickFile('logo', e.target.files?.[0])}
              />
              <button onClick={() => logoFileRef.current?.click()} className={btnSecCls} type="button">
                {t('changePhoto')}
              </button>
            </div>

            <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="storeName">
              {t('storeNameLabel')}
            </label>
            <input
              id="storeName"
              maxLength={60}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className={inputCls + ' mb-4'}
            />

            <label className="block text-sm font-medium text-zinc-700 mb-1" htmlFor="storeBio">
              {t('storeBioLabel')}
            </label>
            <textarea
              id="storeBio"
              maxLength={500}
              rows={3}
              value={storeBio}
              onChange={(e) => setStoreBio(e.target.value)}
              className={inputCls + ' mb-4'}
            />

            <button onClick={saveStore} disabled={storeBusy} className={btnCls}>
              {storeBusy ? '…' : t('saveProfile')}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
