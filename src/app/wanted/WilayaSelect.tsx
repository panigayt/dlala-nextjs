// Dlala wanted page — wilaya filter select (client island).
//
// The wanted page is a Server Component, so the <select> onChange cannot live
// inline there (App Router throws "Event handlers cannot be passed to Client
// Component props" — the whole FilterBar failed SSR on /wanted). This island
// receives only serializable filter data and navigates with router.push,
// keeping the URL-param filter model (?cat=&wilaya=&q=) the port uses for
// back/forward support. Markup/strings byte-identical to the previous SSR
// attempt.

'use client';

import { useRouter } from 'next/navigation';
import { WILAYAS } from '@/lib/wilayas';

interface Filters {
  cat: string;
  wilaya: string;
  q: string;
}

export default function WilayaSelect({ f }: { f: Filters }) {
  const router = useRouter();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = new URLSearchParams();
    if (f.cat) p.set('cat', f.cat);
    const v = e.target.value;
    if (v) p.set('wilaya', v);
    if (f.q) p.set('q', f.q);
    const s = p.toString();
    router.push(s ? `/wanted?${s}` : '/wanted');
  };

  return (
    <div>
      <label htmlFor="wWilaya" className="sr-only">
        الولاية
      </label>
      <select
        id="wWilaya"
        defaultValue={f.wilaya}
        onChange={onChange}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 text-base"
      >
        <option value="">كل الولايات</option>
        {WILAYAS.map((w) => (
          <option key={w.code} value={String(w.code)}>
            {w.code} - {w.ar}
          </option>
        ))}
      </select>
    </div>
  );
}
