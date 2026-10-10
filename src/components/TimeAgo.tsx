'use client';

import { useEffect, useState } from 'react';

// Verbatim port of js/app.js timeAgo() (production 0.0.0.39), incl.
// 0.0.0.31 FIX-WEB-025 day plurals (AR dual/plural forms; FR «il y a N j»;
// EN «Nd ago»). Round 107: the old port only had AR/FR branches, so EN
// users saw French ("à l'instant", "il y a 5 min").
function formatTimeAgo(iso: string, lang: 'ar' | 'fr' | 'en'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return lang === 'ar' ? 'الآن' : lang === 'fr' ? "à l'instant" : 'now';
  if (mins < 60) return `${mins} ${lang === 'ar' ? 'د' : 'min'}`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ${lang === 'ar' ? 'س' : 'h'}`;
  const days = Math.floor(h / 24);
  if (lang === 'ar') {
    if (days === 1) return 'منذ يوم';
    if (days === 2) return 'منذ يومين';
    if (days <= 10) return `منذ ${days} أيام`;
    return `منذ ${days} يوماً`;
  }
  if (lang === 'fr') return `il y a ${days} j`;
  return `${days}d ago`;
}

export default function TimeAgo({
  iso,
  lang = 'ar',
}: {
  iso: string;
  lang?: 'ar' | 'fr' | 'en';
}) {
  const [text, setText] = useState('');
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: avoids Date.now() during SSR/prerender */
  useEffect(() => {
    setText(formatTimeAgo(iso, lang));
  }, [iso, lang]);
  if (!text) return null;
  return <span>{text}</span>;
}
