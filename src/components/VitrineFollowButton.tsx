'use client';

// Follow button inside the vitrine showcase header — the legacy
// `button.follow-btn[data-follow]` (js/home.js vitrineCardHTML, armed via the
// shared js/app.js armFollowButtons/hydrateFollowButtons/onFollowBtnTap in
// v101).
//
// Round 104: the button rendered visually exact but had NO click handler.
// It now reuses useFollowToggle from FollowButton.tsx — the exact same
// behavior as the seller/listing follow buttons: optimistic toggle, guest
// nudge (toast, then /auth — never a silent bounce), owner hides, in-flight
// double-tap guard, follows/{uid}_{storeUid} doc parity, follow notification
// on follow, server-truth reconcile on failure.
//
// Markup is byte-legacy: class="follow-btn", data-follow, aria-pressed,
// `+ متابعة` / `✓ أتابع` (paintFollowBtn verbatim), and the `on` class for
// the following state (legacy css/style.css .follow-btn.on). The styling is
// the verbatim legacy .vitrine-card .follow-btn block in src/app/vitrine.css
// — this component changes BEHAVIOR only, not design.
//
// Legacy armFollowButtons stops propagation on the tap (the card-level click
// marks vitrine interaction for the R17 no-repeat model); reproduced here so
// a follow tap does not mark card interaction.

import { useFollowToggle } from './FollowButton';
import { useLang } from '@/lib/i18n';

export default function VitrineFollowButton({ storeUid }: { storeUid: string }) {
  const { following, isOwn, toast, onTap } = useFollowToggle(storeUid);
  const { t } = useLang();

  // Owner can't follow themselves — legacy hydrateFollowButtons hides it.
  if (isOwn) return null;

  return (
    <span
      // Keeps the exact .vitrine-head flex layout: the legacy rule
      // `.vitrine-card .follow-btn { margin-inline-start: auto }` no longer
      // applies to the button itself (it is no longer the flex item), so the
      // wrapper carries the equivalent geometry inline — zero visual change.
      style={{ position: 'relative', flex: '0 0 auto', marginInlineStart: 'auto' }}
    >
      <button
        type="button"
        className={`follow-btn${following ? ' on' : ''}`}
        data-follow={storeUid}
        aria-pressed={following ? 'true' : 'false'}
        onClick={(e) => {
          // Legacy armFollowButtons parity: follow taps don't mark
          // vitrine-card interaction (R17 no-repeat model).
          e.stopPropagation();
          onTap();
        }}
      >
        {following ? `✓ ${t('following')}` : `+ ${t('follow')}`}
      </button>
      {toast && (
        <span
          role="status"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            borderRadius: 8,
            background: '#18181b',
            color: '#fff',
            padding: '8px 16px',
            fontSize: 14,
            boxShadow: '0 10px 15px -3px rgba(0,0,0,.3)',
            zIndex: 5,
          }}
        >
          {toast}
        </span>
      )}
    </span>
  );
}
