// Site chrome: sticky header + side drawer + footer.
// js/app.js renderChrome parity (PUBLIC_ENTRIES / ACCOUNT_ENTRIES /
// drawerHtml / accountMenuHtml / footer / skip link / badges / identity).
// Rendered by the root layout on every page EXCEPT /chat/* (legacy
// chat.html has its own custom header and no site chrome).
'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
// Round 12: firebase-client user → CDN path. The new useAuthState() loads
// the modular SDK from gstatic lazily inside its effect — the dynamic
// boundary holds: nothing Firebase-shaped enters the initial bundle.
import { useAuthState, type CompatUser, type FirebaseClient } from '@/lib/firebase';
import { useLang, type Lang } from '@/lib/i18n';
import PlatformBanner from './PlatformBanner';
import AuthLinks, { AuthLinksFallback } from './AuthLinks';

// Version shown in the footer (legacy: APP_VERSION).
const APP_VERSION = '0.1.0';

type Entry = { key: string; href: string; page: string; badgeId?: string };

const PUBLIC_ENTRIES: Entry[] = [
  { key: 'home', href: '/', page: 'home' },
  { key: 'publish', href: '/publish', page: 'publish' },
  { key: 'wanted', href: '/wanted', page: 'wanted' },
  { key: 'announcements', href: '/announcements', page: 'announcements' },
  { key: 'favorites', href: '/favorites', page: 'favorites' },
];

// Admin is app-only (Zak, 14 Sep 2026) — no admin entries on web.
const ACCOUNT_ENTRIES: Entry[] = [
  { key: 'account', href: '/account', page: 'account' },
  { key: 'myStore', href: '/my-store', page: 'myStore' },
  { key: 'myAds', href: '/my-listings', page: 'myListings' },
  { key: 'favorites', href: '/favorites', page: 'favorites' },
  { key: 'myFollows', href: '/my-follows', page: 'myFollows' },
  { key: 'messages', href: '/conversations', page: 'messages', badgeId: 'drawerMsgBadge' },
  { key: 'alerts', href: '/alerts', page: 'alerts', badgeId: 'drawerAlertBadge' },
  { key: 'vitrine', href: '/vitrine', page: 'vitrine' },
  { key: 'storeVerify', href: '/store-verify', page: 'storeVerify' },
  { key: 'settings', href: '/settings', page: 'settings' },
];

const LANG_NAMES: Record<Lang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };

// Next route -> legacy page id (drives the .active nav state + aria-current).
function pageIdFor(pathname: string): string {
  const seg = (pathname || '/').split('/')[1] || '';
  switch (seg) {
    case '': return 'home';
    case 'publish': return 'publish';
    case 'wanted': return 'wanted';
    case 'announcements': return 'announcements';
    case 'announcement': return 'announcement';
    case 'favorites': return 'favorites';
    case 'conversations': return 'messages';
    case 'chat': return 'chat';
    case 'alerts': return 'alerts';
    case 'account': return 'account';
    case 'my-listings': return 'myListings';
    case 'my-follows': return 'myFollows';
    case 'my-store': return 'myStore';
    case 'store-verify': return 'storeVerify';
    case 'settings': return 'settings';
    case 'vitrine': return 'vitrine';
    case 'seller': return 'seller';
    case 'listing': return 'listing';
    case 'privacy': return 'privacy';
    case 'terms': return 'terms';
    case 'auth': return 'auth';
    case 'auth-action': return 'authAction';
    default: return 'home';
  }
}

function badgeText(n: number): string {
  return n > 9 ? '9+' : String(n);
}

// DF-O2 (Round 34, 18 Oct 2026): badge-count TTL cache. refreshBadges runs
// on every full page load for signed-in users; a fresh cache entry lets it
// skip all Firestore queries. Per-uid key so a uid change misses the cache.
const BADGE_TTL_MS = 60_000;
const badgeCacheKey = (uid: string) => `dlala_badges_${uid}`;

interface ProfileData {
  name?: string;
  username?: string;
  photoPath?: string;
  storeTier?: string;
}

function ChromeInner({ children }: { children: React.ReactNode }) {
  // NOTE (Round 43): usePathname() suspends during static prerender, which
  // defers this whole subtree (incl. page children) to client rendering —
  // static pages prerender as empty shells (guides SEO bug, Oct 2026).
  // Round 42 tried rendering children in the Suspense fallback instead, but
  // that breaks the build: data pages await uncached Firestore reads outside
  // Suspense ("uncached or runtime data during prerendering"). The working
  // model: pages that need SSR HTML must not be statically prerendered —
  // they use `export const dynamic = 'force-dynamic'` and render fully at
  // request time, where usePathname() resolves normally (guides, Oct 2026).
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const auth = useAuthState();

  const activePage = pageIdFor(pathname);
  const isChat = pathname.startsWith('/chat');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [toast, setToast] = useState<string | null>(null);

  const drawerRef = useRef<HTMLElement | null>(null);
  const prevFocus = useRef<Element | null>(null);
  const toastTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  // Latest signed-in uid, updated in an effect — guards the delayed
  // profile auto-retry against a sign-out/sign-in change mid-wait.
  const latestUid = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const signedIn = auth.status === 'signed-in';
  const user: CompatUser | null = signedIn ? auth.user : null;
  const client: FirebaseClient | null = signedIn ? auth.client : null;

  useEffect(() => {
    latestUid.current = signedIn && user ? user.uid : null;
  }, [signedIn, user]);

  // Referral capture: ?ref=CODE -> localStorage (js/app.js renderChrome parity).
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) localStorage.setItem('dlala_ref', ref);
    } catch { /* never break chrome render */ }
  }, []);

  // FIX-WEB-015: the skip link must move keyboard focus to #main-content.
  // Pages render their own <main id="main-content">; ensure it carries the id.
  useEffect(() => {
    try {
      const main = document.querySelector('main');
      if (main && !main.id) main.id = 'main-content';
    } catch { /* ignore */ }
  }, [pathname]);

  const onSkipLink = useCallback((e: React.MouseEvent) => {
    const main = document.getElementById('main-content');
    if (main) {
      e.preventDefault();
      try { main.setAttribute('tabindex', '-1'); } catch { /* ignore */ }
      main.focus({ preventScroll: false });
      if (document.activeElement !== main) main.focus();
    }
  }, []);

  // Nav profile: the owner's own users/{uid} doc (legacy loadNavProfile,
  // P1-5 REST approach replaced here by the SDK read — Round 12: modular).
  // Async: state is only set in async continuations (after await) —
  // no synchronous setState in the effect body (cascading-render safe).
  // Round 16 (post-signup commit race): onAuthStateChanged fires
  // synchronously inside createUserWithEmailAndPassword, BEFORE signup's
  // ensureUserDoc batch commits — the first getDoc can miss a doc that
  // lands <2s later. A miss therefore retries ONCE after ~2s before
  // latching 'error'. Genuine misses (long-deleted docs etc.) still latch
  // error after the single bounded retry.
  const loadProfileAsync = useCallback(async (attempt = 0) => {
    if (!user || !client) return;
    const uid = user.uid;
    setProfileState('loading');
    try {
      const { db, fsMod } = client;
      const snap = await fsMod.getDoc(fsMod.doc(db, 'users/' + uid));
      if (!mounted.current) return;
      if (snap.exists()) {
        setProfile((snap.data() || {}) as ProfileData);
        setProfileState('ready');
        return;
      }
      if (attempt < 1) {
        // Bounded auto-retry for the post-signup commit race.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!mounted.current || latestUid.current !== uid) return;
        await loadProfileAsync(attempt + 1);
        return;
      }
      setProfileState('error');
    } catch {
      if (mounted.current) setProfileState('error');
    }
  }, [user, client]);

  useEffect(() => {
    (async () => {
      if (signedIn && user && client) {
        await loadProfileAsync();
      } else if (mounted.current) {
        // Signed out: clear the signed-in chrome state.
        setProfile(null);
        setProfileState('idle');
        setUnreadMsgs(0);
        setUnreadAlerts(0);
      }
    })();
  }, [signedIn, user, client, loadProfileAsync]);

  const retryProfile = useCallback(() => {
    void loadProfileAsync();
  }, [loadProfileAsync]);

  // Badges: one-shot unread counts (legacy refreshNavMsgBadge + refreshBell).
  // 12 Oct 2026: refactored to refreshable function + event listener for
  // alerts-read (was stale until full reload).
  // DF-O2 (Round 34, 18 Oct 2026): this used to fire up to 4 SEQUENTIAL
  // Firestore queries on every full page load for signed-in users. Two
  // reductions: (1) the three independent queries (conversations,
  // notifications, savedSearches) now run concurrently via Promise.all;
  // (2) a 60s per-uid TTL cache (localStorage) skips all queries when the
  // last successful refresh is fresh. The dlala:alerts-read event passes
  // force=true; a uid change misses the cache (uid-scoped key).
  const refreshBadges = useCallback(async (force = false) => {
    if (!user || !client) return;
    const uid = user.uid;
    if (!force) {
      try {
        const raw = localStorage.getItem(badgeCacheKey(uid));
        if (raw) {
          const cached = JSON.parse(raw) as { at?: number; msgs?: number; alerts?: number };
          if (
            cached && typeof cached.at === 'number' &&
            Date.now() - cached.at < BADGE_TTL_MS &&
            typeof cached.msgs === 'number' && typeof cached.alerts === 'number' &&
            mounted.current
          ) {
            setUnreadMsgs(cached.msgs);
            setUnreadAlerts(cached.alerts);
            return;
          }
        }
      } catch { /* ignore: fall through to a fresh refresh */ }
    }
    try {
      // Round 12: modular Firestore.
      const { db, fsMod } = client;
      // Unread messages: bounded to the 50 most recent conversations
      // (P1-6 — the (participants, updatedAt) composite index exists).
      // DF-O2: the three independent queries run concurrently (were sequential).
      const [cSnap, nSnap, sSnap] = await Promise.all([
        fsMod.getDocs(
          fsMod.query(
            fsMod.collection(db, 'conversations'),
            fsMod.where('participants', 'array-contains', uid),
            fsMod.orderBy('updatedAt', 'desc'),
            fsMod.limit(50)
          )
        ),
        // Alerts bell: unread notifications. AC-3 (Round 7, 18 Oct 2026):
        // removed the limit(20) cap — the badge must reflect the true
        // unread count, not cap at 20.
        fsMod.getDocs(
          fsMod.query(
            fsMod.collection(db, 'users', uid, 'notifications'),
            fsMod.where('read', '==', false)
          )
        ),
        fsMod.getDocs(fsMod.collection(db, 'users', uid, 'savedSearches')),
      ]);
      let n = 0;
      cSnap.forEach((d) => {
        const unread = (d.data().unread || {}) as Record<string, number>;
        n += unread[uid] || 0;
      });
      if (mounted.current) setUnreadMsgs(n);
      let bellCount = nSnap.size;
      // AC-1 (Round 7, 18 Oct 2026): the bell ignored saved-search matches.
      // Count new (unseen) matches across enabled saved searches.
      try {
        const { matchesSavedSearch, tsMs } = await import('@/lib/savedSearchMatch');
        const searches = sSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as { id: string; enabled?: boolean })
          .filter((s) => s.enabled !== false);
        if (searches.length) {
          const lSnap = await fsMod.getDocs(
            fsMod.query(
              fsMod.collection(db, 'listings'),
              fsMod.where('status', 'in', ['available', 'negotiating']),
              fsMod.orderBy('createdAt', 'desc'),
              fsMod.limit(60)
            )
          );
          let seen: Record<string, number> = {};
          try {
            const raw = JSON.parse(localStorage.getItem(`dlala_seen_${uid}`) || '{}');
            if (raw && typeof raw === 'object') seen = raw;
          } catch { /* ignore */ }
          // DF-O1 (Round 34, 18 Oct 2026): apply the R16 cross-group dedup
          // to the badge — a listing matching several enabled searches
          // counted N× before; it now counts once, matching the inbox.
          const countedIds = new Set<string>();
          for (const s of searches) {
            const last = seen[s.id] || 0;
            for (const ld of lSnap.docs) {
              if (countedIds.has(ld.id)) continue;
              const l = { id: ld.id, ...ld.data() } as Parameters<typeof matchesSavedSearch>[0];
              if (matchesSavedSearch(l, s) && tsMs(l.createdAt) > last) {
                countedIds.add(ld.id);
                bellCount++;
              }
            }
          }
        }
      } catch { /* best-effort: badge falls back to notifications only */ }
      if (mounted.current) setUnreadAlerts(bellCount);
      try {
        localStorage.setItem(
          badgeCacheKey(uid),
          JSON.stringify({ at: Date.now(), msgs: n, alerts: bellCount })
        );
      } catch { /* ignore */ }
    } catch { /* best-effort: badges stay hidden */ }
  }, [user, client]);

  useEffect(() => {
    refreshBadges();
    // Listen for alerts-read event from /alerts page.
    const onAlertsRead = () => refreshBadges(true);
    window.addEventListener('dlala:alerts-read', onAlertsRead);
    return () => window.removeEventListener('dlala:alerts-read', onAlertsRead);
  }, [refreshBadges]);

  // Drawer: Escape closes, focus trap while open, inert when closed,
  // body class locks scroll, focus returns to the opener on close.
  // (0.0.0.21 A-14 focus containment + FD-007 inert parity.)
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // Round 140 (Zak, 10 Oct 2026): tapping a drawer NAVIGATION link must close
  // the drawer INSTANTLY (no 250ms slide-out) — otherwise the slide animation
  // races the client-side page transition and the menu glitches mid-screen
  // on mobile. Non-navigating closes (✕, Escape, overlay) keep the animation.
  const [drawerInstant, setDrawerInstant] = useState(false);
  const closeDrawerInstant = useCallback(() => {
    setDrawerInstant(true);
    setDrawerOpen(false);
  }, []);
  // Restore the slide animation when the drawer is opened again (the
  // hamburger is the only opener).
  const openDrawer = useCallback(() => {
    setDrawerInstant(false);
    setDrawerOpen(true);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    try { prevFocus.current = document.activeElement; } catch { prevFocus.current = null; }
    document.body.classList.add('drawer-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDrawerOpen(false); return; }
      if (e.key !== 'Tab') return;
      const d = drawerRef.current;
      if (!d) return;
      const f = Array.from(
        d.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !(el as HTMLElement).hasAttribute('disabled')) as HTMLElement[];
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const closeBtn = document.getElementById('drawerClose');
    if (closeBtn) closeBtn.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('drawer-open');
      const prev = prevFocus.current;
      prevFocus.current = null;
      if (prev && (prev as HTMLElement).focus && document.contains(prev)) {
        try { (prev as HTMLElement).focus(); } catch { /* ignore */ }
      }
    };
  }, [drawerOpen]);

  // Account dropdown: close on outside click / Escape / link follow.
  useEffect(() => {
    if (!acctOpen) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest || !el.closest('#accountMenu')) setAcctOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAcctOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [acctOpen]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (mounted.current) setToast(null);
    }, 2600);
  }, []);

  const doLogout = useCallback(async () => {
    closeDrawerInstant();
    setAcctOpen(false);
    if (!client) return;
    try {
      await client.authMod.signOut(client.auth);
    } catch {
      showToast(t('logoutFailed'));
      return;
    }
    router.push('/');
  }, [client, router, showToast, t, closeDrawerInstant]);

  // Drawer "Aide" actions (js/app.js wireDrawerActions parity):
  // "Nous contacter" opens the support thread; "Signaler un problème"
  // deep-links to the ticket dialog in Settings (#report).
  const openSupportThread = useCallback(() => {
    closeDrawerInstant();
    if (!user) { router.push('/auth?return=' + encodeURIComponent('/settings')); return; }
    router.push('/chat/supp_' + user.uid);
  }, [user, router, closeDrawerInstant]);
  const openReportDialog = useCallback(() => {
    closeDrawerInstant();
    if (!user) { router.push('/auth?return=' + encodeURIComponent('/settings#report')); return; }
    router.push('/settings#report');
  }, [user, router, closeDrawerInstant]);

  // Legacy chat.html ships its own custom header and NO site chrome — but it
  // DOES include js/banner-early.js, so the platform banner shows there too.
  if (isChat) return <><PlatformBanner onToast={showToast} />{children}</>;

  const isPro = profile?.storeTier === 'verified';
  // 20 Sep 2026 (Zak): entries are pro-conditional — «متجري» replaces
  // «إعلاناتي» for verified merchants (legacy accountEntriesFor).
  const accountEntries = ACCOUNT_ENTRIES.filter((e) => {
    if (e.key === 'myStore') return isPro;
    if (isPro && (e.key === 'myAds' || e.key === 'storeVerify')) return false;
    return true;
  });

  const headerLabel = profile?.name || user?.displayName || t('account');
  const onAccountPage = accountEntries.some((e) => e.page === activePage);

  const navLink = (e: Entry, onNavigate?: () => void) => {
    const isActive = activePage === e.page;
    return (
      <Link
        key={e.page + e.href}
        href={e.href}
        className={isActive ? 'active' : ''}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
      >
        {t(e.key)}
        {e.badgeId === 'drawerMsgBadge' && unreadMsgs > 0 && (
          <span className="nav-badge">{badgeText(unreadMsgs)}</span>
        )}
        {e.badgeId === 'drawerAlertBadge' && unreadAlerts > 0 && (
          <span className="nav-badge">{badgeText(unreadAlerts)}</span>
        )}
      </Link>
    );
  };

  // NAV-4/AUT-4: login/signup links with ?mode=signup and ?return= are rendered
  // by the isolated <AuthLinks> component (useSearchParams() must not run at
  // the SiteChrome top level — it breaks static generation for /guides/*).
  const isAuthPage = activePage === 'auth';

  const langButtons = () =>
    (['ar', 'fr', 'en'] as Lang[]).map((l) => (
      <button
        key={l}
        className={'lang-btn' + (lang === l ? ' active' : '')}
        onClick={() => setLang(l)}
        lang={l}
        aria-label={LANG_NAMES[l]}
        aria-pressed={lang === l ? 'true' : 'false'}
      >
        {l.toUpperCase()}
      </button>
    ));

  const identity = !user ? null : profileState === 'loading' || profileState === 'idle' ? (
    <div className="drawer-identity" aria-busy="true" aria-label={t('loading')}>
      <div className="drawer-avatar skel" />
      <div className="drawer-id-meta">
        <div className="skel-line skel" />
        <div className="skel-line short skel" />
      </div>
    </div>
  ) : profileState === 'error' ? (
    <div className="drawer-identity drawer-identity-err">
      <div className="drawer-avatar">⚠️</div>
      <div className="drawer-id-meta">
        <div className="drawer-id-name">{t('profileLoadError')}</div>
        <button className="btn btn-secondary btn-sm" onClick={retryProfile} style={{ marginTop: 6 }}>
          {t('retry')}
        </button>
      </div>
    </div>
  ) : (
    <Link className="drawer-identity" href="/account" onClick={closeDrawerInstant}>
      <div className="drawer-avatar">
        {profile?.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photoPath} alt="" />
        ) : (
          <span aria-hidden="true">{(profile?.name || user.displayName || '?').charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="drawer-id-meta">
        <div className="drawer-id-name">{profile?.name || user.displayName || user.email || ''}</div>
        {profile?.username ? <div className="drawer-id-user" dir="ltr">@{profile.username}</div> : null}
        {user.emailVerified === false ? (
          <span className="unverified-badge">{t('unverifiedBadge')}</span>
        ) : null}
      </div>
    </Link>
  );

  const drawerLinks = !user ? (
    <>
      {PUBLIC_ENTRIES.map((e) => navLink(e, closeDrawerInstant))}
      <Suspense fallback={<AuthLinksFallback t={t} />}>
        <AuthLinks
          isAuthPage={isAuthPage}
          pathname={pathname}
          t={t}
          onNavigate={closeDrawerInstant}
        />
      </Suspense>
    </>
  ) : (
    <>
      <div className="drawer-group-label">{t('navMain')}</div>
      {PUBLIC_ENTRIES.filter((e) => e.key !== 'favorites').map((e) => navLink(e, closeDrawerInstant))}
      <div className="drawer-group-label">{t('navSpace')}</div>
      {accountEntries
        .filter((e) => e.key !== 'settings' && e.key !== 'alerts')
        .map((e) => navLink(e, closeDrawerInstant))}
      <div className="drawer-group-label">{t('navHelp')}</div>
      <button className="drawer-link" onClick={openSupportThread}>{t('contactSupport')}</button>
      <button className="drawer-link" onClick={openReportDialog}>{t('reportProblem')}</button>
      <div className="drawer-sep" role="separator" aria-hidden="true" />
      {navLink(ACCOUNT_ENTRIES.find((e) => e.key === 'settings')!, closeDrawerInstant)}
      {/* 11 Oct 2026: alerts in drawer — mobile users had no alerts link. */}
      {navLink(ACCOUNT_ENTRIES.find((e) => e.key === 'alerts')!, closeDrawerInstant)}
    </>
  );

  // Round 43: build-time year from next.config `env` (inlined as a literal).
  // NEVER call new Date() here — Next 16 fails the whole build when a client
  // component evaluates it during static prerender ("unstable value";
  // silently blocked the 5e322b7/ec5982a/9025853 Vercel deploys, 15 Oct 2026).
  const year = Number(process.env.DLALA_BUILD_YEAR) || 2026;
  // Round 14 T14: footer guide links follow the current UI language —
  // EN readers get /en/guides/<slug> (EN articles exist for all 4 slugs),
  // FR readers get /fr/guides/<slug>, AR stays /guides/<slug>. Uses the
  // same `lang` from useLang() the footer already resolves.
  const guidePrefix = lang === 'fr' ? '/fr' : lang === 'en' ? '/en' : '';

  return (
    <>
      {/* Legacy body.prepend parity: banner sits above the sticky header */}
      <PlatformBanner onToast={showToast} />
      <a className="skip-link" href="#main-content" onClick={onSkipLink}>
        {t('skipToContent')}
      </a>
      <header id="site-header">
        <div className="header-inner">
          <button
            className="hamburger"
            id="hamburgerBtn"
            aria-label={t('menu')}
            aria-expanded={drawerOpen ? 'true' : 'false'}
            aria-controls="drawer"
            onClick={openDrawer}
          >
            ☰
          </button>
          <Link className="logo" href="/">
            <span className="logo-d">D</span>
            <span className="logo-dot">.</span>
            <span className="logo-name">{t('appName')}</span>
          </Link>
          <nav className="nav" aria-label={t('menu')}>
            {PUBLIC_ENTRIES.map((e) => navLink(e))}
            {user ? (
              <Link
                href="/conversations"
                className={activePage === 'messages' ? 'active' : ''}
                aria-current={activePage === 'messages' ? 'page' : undefined}
              >
                {t('messages')}
                {unreadMsgs > 0 && <span className="nav-badge" id="navMsgBadge">{badgeText(unreadMsgs)}</span>}
              </Link>
            ) : null}
            {!user ? (
              <Suspense fallback={<AuthLinksFallback t={t} />}>
                <AuthLinks
                  isAuthPage={isAuthPage}
                  pathname={pathname}
                  t={t}
                />
              </Suspense>
            ) : null}
            {user ? (
              <Link
                href="/alerts"
                className={'bell' + (activePage === 'alerts' ? ' active' : '')}
                aria-current={activePage === 'alerts' ? 'page' : undefined}
                aria-label={t('alerts')}
              >
                🔔
                {unreadAlerts > 0 && <span className="badge" id="bellBadge">{badgeText(unreadAlerts)}</span>}
              </Link>
            ) : null}
          </nav>
          {user ? (
            <div className={'account-menu' + (acctOpen ? ' open' : '')} id="accountMenu">
              <button
                className={'account-toggle' + (onAccountPage ? ' active' : '')}
                id="accountToggle"
                aria-haspopup="true"
                aria-expanded={acctOpen ? 'true' : 'false'}
                aria-label={t('account')}
                onClick={(e) => { e.stopPropagation(); setAcctOpen((v) => !v); }}
              >
                <span className="account-toggle-name">{headerLabel}</span>
                <span className="caret" aria-hidden="true">▾</span>
              </button>
              <div className="account-dropdown" id="accountDropdown" role="menu" aria-label={t('account')}>
                <div id="accountMenuEntries" onClick={() => setAcctOpen(false)}>
                  {accountEntries
                    .filter((e) => e.key !== 'alerts')
                    .map((e) => navLink(e))}
                </div>
                <div className="acct-sep" role="separator" aria-hidden="true" />
                <button className="acct-logout-btn" role="menuitem" onClick={doLogout}>
                  ⏻ {t('logout')}
                </button>
              </div>
            </div>
          ) : null}
          <div className="lang-switch">{langButtons()}</div>
        </div>
      </header>

      <div
        className={'drawer-overlay' + (drawerOpen ? ' open' : '') + (drawerInstant ? ' no-anim' : '')}
        id="drawerOverlay"
        onClick={closeDrawer}
      />
      <aside
        className={'drawer' + (drawerOpen ? ' open' : '') + (drawerInstant ? ' no-anim' : '')}
        id="drawer"
        ref={drawerRef}
        aria-label={t('menu')}
        role="dialog"
        aria-modal="true"
        inert={!drawerOpen}
      >
        <div className="drawer-head">
          <Link className="logo" href="/" onClick={closeDrawerInstant}>
            <span className="logo-d">D</span>
            <span className="logo-dot">.</span>
            <span className="logo-name">{t('appName')}</span>
          </Link>
          <button className="drawer-close" id="drawerClose" aria-label={t('close')} onClick={closeDrawer}>
            ✕
          </button>
        </div>
        {identity}
        <nav className="drawer-nav" aria-label={t('menu')}>
          {drawerLinks}
        </nav>
        {user ? (
          <div className="drawer-foot">
            <button className="btn drawer-logout-btn" aria-label={t('logout')} onClick={doLogout}>
              ⏻ {t('logout')}
            </button>
          </div>
        ) : null}
        <div className="drawer-lang">{langButtons()}</div>
      </aside>

      {children}

      <footer id="site-footer">
        <div className="footer-inner">
          <span>{t('allRights')}</span>
          <span className="footer-links">
            <Link href="/privacy">{t('privacyLink')}</Link> · {APP_VERSION}
          </span>
          <div className="footer-guides">
            <strong>📚 {t('guidesTitle')}</strong>
            <br />
            <Link href={`${guidePrefix}/guides/acheter-voiture-occasion`}>{t('guideCar')}</Link> ·{' '}
            <Link href={`${guidePrefix}/guides/prix-voitures-occasion-${year}`}>
              {t('guidePrices').replace(/ ?20\d\d/g, '').trim() + ' ' + year}
            </Link> ·{' '}
            <Link href={`${guidePrefix}/guides/controler-telephone-occasion`}>{t('guidePhone')}</Link> ·{' '}
            <Link href={`${guidePrefix}/guides/eviter-arnaques`}>{t('guideScam')}</Link>
          </div>
        </div>
      </footer>

      {toast ? (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 80, insetInline: 16, zIndex: 100,
            background: '#111827', color: '#fff', borderRadius: 10,
            padding: '10px 16px', textAlign: 'center',
          }}
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ChromeInner>{children}</ChromeInner>
    </Suspense>
  );
}
