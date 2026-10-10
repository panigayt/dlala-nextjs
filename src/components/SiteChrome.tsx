// Site chrome: sticky header + side drawer + footer.
// js/app.js renderChrome parity (PUBLIC_ENTRIES / ACCOUNT_ENTRIES /
// drawerHtml / accountMenuHtml / footer / skip link / badges / identity).
// Rendered by the root layout on every page EXCEPT /chat/* (legacy
// chat.html has its own custom header and no site chrome).
'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuthState, type CompatUser, type FirebaseClient } from '@/lib/firebase-client';
import { useLang, type Lang } from '@/lib/i18n';
import PlatformBanner from './PlatformBanner';

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

interface ProfileData {
  name?: string;
  username?: string;
  photoPath?: string;
  storeTier?: string;
}

function ChromeInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
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
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const signedIn = auth.status === 'signed-in';
  const user: CompatUser | null = signedIn ? auth.user : null;
  const client: FirebaseClient | null = signedIn ? auth.client : null;

  // Referral capture: ?ref=CODE -> localStorage (js/app.js renderChrome parity).
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) localStorage.setItem('dlala_ref', ref);
    } catch { /* never break chrome render */ }
  }, []);

  // FIX-WEB-015: the skip link must move keyboard focus to #main-content.
  // Pages render their own <main>; ensure it carries the id.
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
  // P1-5 REST approach replaced here by the compat SDK read).
  // Async: state is only set in async continuations (after await) —
  // no synchronous setState in the effect body (cascading-render safe).
  const loadProfileAsync = useCallback(async () => {
    if (!user || !client) return;
    const uid = user.uid;
    setProfileState('loading');
    try {
      const db = client.db as unknown as {
        doc: (p: string) => { get: () => Promise<{ exists: boolean; data: () => ProfileData | undefined }> };
      };
      const snap = await db.doc('users/' + uid).get();
      if (!mounted.current) return;
      if (snap.exists) {
        setProfile((snap.data() || {}) as ProfileData);
        setProfileState('ready');
      } else {
        setProfileState('error');
      }
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
  useEffect(() => {
    if (!user || !client) return;
    const uid = user.uid;
    (async () => {
      try {
        const db = client.db as unknown as {
          collection: (p: string) => {
            where: (f: string, op: string, v: unknown) => {
              orderBy: (f: string, d: string) => { limit: (n: number) => { get: () => Promise<{ forEach: (cb: (d: { data: () => Record<string, unknown> }) => void) => void; size: number }> } };
              limit: (n: number) => { get: () => Promise<{ size: number }> };
            };
          };
        };
        // Unread messages: bounded to the 50 most recent conversations
        // (P1-6 — the (participants, updatedAt) composite index exists).
        const cSnap = await db.collection('conversations')
          .where('participants', 'array-contains', uid)
          .orderBy('updatedAt', 'desc').limit(50).get();
        let n = 0;
        cSnap.forEach((d) => {
          const unread = (d.data().unread || {}) as Record<string, number>;
          n += unread[uid] || 0;
        });
        if (mounted.current) setUnreadMsgs(n);
        // Alerts bell: unread notifications.
        const nSnap = await db.collection(`users/${uid}/notifications`)
          .where('read', '==', false).limit(20).get();
        if (mounted.current) setUnreadAlerts(nSnap.size);
      } catch { /* best-effort: badges stay hidden */ }
    })();
  }, [user, client]);

  // Drawer: Escape closes, focus trap while open, inert when closed,
  // body class locks scroll, focus returns to the opener on close.
  // (0.0.0.21 A-14 focus containment + FD-007 inert parity.)
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
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
    setDrawerOpen(false);
    setAcctOpen(false);
    if (!client) return;
    try {
      await client.auth.signOut();
    } catch {
      showToast(t('logoutFailed'));
      return;
    }
    router.push('/');
  }, [client, router, showToast, t]);

  // Drawer "Aide" actions (js/app.js wireDrawerActions parity):
  // "Nous contacter" opens the support thread; "Signaler un problème"
  // deep-links to the ticket dialog in Settings (#report).
  const openSupportThread = useCallback(() => {
    setDrawerOpen(false);
    if (!user) { router.push('/auth?return=' + encodeURIComponent('/settings')); return; }
    router.push('/chat/supp_' + user.uid);
  }, [user, router]);
  const openReportDialog = useCallback(() => {
    setDrawerOpen(false);
    if (!user) { router.push('/auth?return=' + encodeURIComponent('/settings#report')); return; }
    router.push('/settings#report');
  }, [user, router]);

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

  // NAV-4: login vs signup active state follows ?mode=signup. The login link
  // carries ?return= so the user lands back where they came from (AUT-4).
  const signupMode = searchParams.get('mode') === 'signup';
  const isAuthPage = activePage === 'auth';
  const returnParam = !isAuthPage
    ? '?return=' + encodeURIComponent(pathname + (searchParams.toString() ? '?' + searchParams.toString() : ''))
    : '';

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
    <Link className="drawer-identity" href="/account" onClick={closeDrawer}>
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
      {PUBLIC_ENTRIES.map((e) => navLink(e))}
      <Link
        href={'/auth' + returnParam}
        className={!isAuthPage || signupMode ? '' : 'active'}
        aria-current={!isAuthPage || signupMode ? undefined : 'page'}
        onClick={closeDrawer}
      >
        {t('login')}
      </Link>
      <Link
        href="/auth?mode=signup"
        className={signupMode ? 'active' : ''}
        aria-current={signupMode ? 'page' : undefined}
        onClick={closeDrawer}
      >
        {t('signup')}
      </Link>
    </>
  ) : (
    <>
      <div className="drawer-group-label">{t('navMain')}</div>
      {PUBLIC_ENTRIES.filter((e) => e.key !== 'favorites').map((e) => navLink(e, closeDrawer))}
      <div className="drawer-group-label">{t('navSpace')}</div>
      {accountEntries
        .filter((e) => e.key !== 'settings' && e.key !== 'alerts')
        .map((e) => navLink(e, closeDrawer))}
      <div className="drawer-group-label">{t('navHelp')}</div>
      <button className="drawer-link" onClick={openSupportThread}>{t('contactSupport')}</button>
      <button className="drawer-link" onClick={openReportDialog}>{t('reportProblem')}</button>
      <div className="drawer-sep" role="separator" aria-hidden="true" />
      {navLink(ACCOUNT_ENTRIES.find((e) => e.key === 'settings')!, closeDrawer)}
    </>
  );

  const year = new Date().getFullYear();

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
            onClick={() => setDrawerOpen(true)}
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
              <>
                <Link
                  href={'/auth' + returnParam}
                  className={isAuthPage && !signupMode ? 'active' : ''}
                  aria-current={isAuthPage && !signupMode ? 'page' : undefined}
                >
                  {t('login')}
                </Link>
                <Link
                  href="/auth?mode=signup"
                  className={isAuthPage && signupMode ? 'active' : ''}
                  aria-current={isAuthPage && signupMode ? 'page' : undefined}
                >
                  {t('signup')}
                </Link>
              </>
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
        className={'drawer-overlay' + (drawerOpen ? ' open' : '')}
        id="drawerOverlay"
        onClick={closeDrawer}
      />
      <aside
        className={'drawer' + (drawerOpen ? ' open' : '')}
        id="drawer"
        ref={drawerRef}
        aria-label={t('menu')}
        role="dialog"
        aria-modal="true"
        inert={!drawerOpen}
      >
        <div className="drawer-head">
          <Link className="logo" href="/" onClick={closeDrawer}>
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
            <Link href={`${lang === 'fr' ? '/fr' : ''}/guides/acheter-voiture-occasion`}>{t('guideCar')}</Link> ·{' '}
            <Link href={`${lang === 'fr' ? '/fr' : ''}/guides/prix-voitures-occasion-${year}`}>
              {t('guidePrices').replace(/ ?20\d\d/g, '').trim() + ' ' + year}
            </Link> ·{' '}
            <Link href={`${lang === 'fr' ? '/fr' : ''}/guides/controler-telephone-occasion`}>{t('guidePhone')}</Link> ·{' '}
            <Link href={`${lang === 'fr' ? '/fr' : ''}/guides/eviter-arnaques`}>{t('guideScam')}</Link>
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
