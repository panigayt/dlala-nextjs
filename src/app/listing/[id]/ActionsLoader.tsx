'use client';

// Round 17 T11 (initial-JS audit): next/dynamic() called directly in a Server
// Component does NOT code-split — Next 16 docs: "When a Server Component
// dynamically imports a Client Component, automatic code splitting is
// currently not supported." The full ListingActions module (33KB source:
// favorite/contact/propose/share/report + dialogs) was shipping inside the
// listing page's INITIAL JS (verified in the built chunks).
//
// Moving the dynamic() boundary into this tiny client wrapper restores the
// split: the buttons' JS loads as a separate chunk immediately after first
// paint, while SSR still renders the real buttons (ssr default true), so
// first paint is visually unchanged — no skeleton flash, no layout shift.
// The skeleton only shows if the chunk is slow.

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type ListingActions from './ListingActions';

function ActionsSkeleton() {
  return (
    <div
      className="mt-[14px] rounded-xl bg-white border border-[#e5e7eb] p-[10px]"
      aria-hidden="true"
    >
      <div className="grid grid-cols-2 gap-[6px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[34px] rounded-lg bg-zinc-100 animate-pulse" />
        ))}
        <div className="h-[34px] rounded-lg bg-zinc-100 animate-pulse col-span-2" />
      </div>
    </div>
  );
}

const ListingActionsLazy = dynamic(() => import('./ListingActions'), {
  loading: () => <ActionsSkeleton />,
});

export default function ActionsLoader(
  props: ComponentProps<typeof ListingActions>
) {
  return <ListingActionsLazy {...props} />;
}
