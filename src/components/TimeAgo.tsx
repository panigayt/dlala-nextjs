'use client';

import { useEffect, useState } from 'react';

function formatTimeAgo(iso: string, lang = 'ar'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return lang === 'ar' ? 'الآن' : "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return lang === 'ar' ? `منذ ${m} د` : `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === 'ar' ? `منذ ${h} س` : `il y a ${h} h`;
  const days = Math.floor(h / 24);
  return lang === 'ar' ? `منذ ${days} يوم` : `il y a ${days} j`;
}

export default function TimeAgo({ iso, lang = 'ar' }: { iso: string; lang?: string }) {
  const [text, setText] = useState('');
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: avoids Date.now() during SSR/prerender */
  useEffect(() => {
    setText(formatTimeAgo(iso, lang));
  }, [iso, lang]);
  if (!text) return null;
  return <span>{text}</span>;
}
