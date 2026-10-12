// Publish duplicate pre-check — verbatim port of js/publish.js checkDuplicates
// plus the market.js helpers it uses (normalizeListingTitle,
// titleSimilarity, areTitlesDuplicate, hammingHex, arePhotosDuplicate).
//
// Guards against a seller re-publishing a near-identical ad of their own:
// near-duplicate titles (Arabic-aware) or already-used photos in the
// seller's own live listings of the same category block publish/edit.

// 11 Oct 2026: withTimeout now in @/lib/timeout — no firebase-compat import.
// 12 Oct 2026 (Round 12): migrated to the modular Firebase SDK
// (@/lib/firebase). Takes the full FirebaseClient (queries via fsMod.*);
// no firebase-compat/firebase-client imports remain.
import { withTimeout } from '@/lib/timeout';
import type { FirebaseClient } from '@/lib/firebase';

export type DuplicateKind = 'title' | 'photo';

// --- Arabic-aware title normalization (market.js, byte-exact) -------------

export function normalizeListingTitle(raw: unknown): string {
  let t = String(raw || '').trim();
  t = t.replace(/[ً-ْٰـ]/g, '');
  t = t.replace(/[أإآٱ]/g, 'ا');
  t = t.replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  t = t.replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const eastern = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
  const ascii = '01234567890123456789';
  for (let i = 0; i < eastern.length; i++) t = t.split(eastern[i]).join(ascii[i]);
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function titleSimilarity(a: unknown, b: unknown): number {
  const ta = new Set(normalizeListingTitle(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeListingTitle(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((w) => {
    if (tb.has(w)) inter++;
  });
  return inter / Math.min(ta.size, tb.size);
}

export function areTitlesDuplicate(a: unknown, b: unknown, threshold = 0.8): boolean {
  const na = normalizeListingTitle(a);
  const nb = normalizeListingTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  ta.forEach((w) => {
    if (tb.has(w)) inter++;
  });
  if (inter < 2) return false;
  return titleSimilarity(a, b) >= threshold;
}

// --- perceptual aHash distance (market.js, byte-exact) ---------------------

export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

export function arePhotosDuplicate(a: string, b: string): boolean {
  return hammingHex(a, b) <= 5;
}

// --- the pre-publish check (js/publish.js checkDuplicates, byte-exact) ----

interface CheckDuplicatesArgs {
  client: FirebaseClient;
  uid: string;
  title: string;
  categoryId: string;
  newHashes: string[];
  excludeId?: string;
}

export async function checkDuplicates({
  client,
  uid,
  title,
  categoryId,
  newHashes,
  excludeId,
}: CheckDuplicatesArgs): Promise<DuplicateKind | null> {
  const { db, fsMod } = client;
  // D1 fix: 500 cap (high-volume sellers silently lost duplicate
  // protection beyond 100 listings). M1 fix: 30s timeout (was: unbounded
  // hang) — fails OPEN to "no duplicate found" rather than blocking
  // publish forever.
  let snap;
  try {
    snap = await withTimeout(
      fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'listings'),
          fsMod.where('sellerId', '==', uid),
          fsMod.limit(500)
        )
      ),
      30000
    );
  } catch (e) {
    console.warn('checkDuplicates timed out, skipping duplicate check', e);
    return null;
  }
  for (const d of snap.docs) {
    if (d.id === excludeId) continue;
    const l = d.data() || {};
    if (l.status === 'sold') continue;
    if (l.categoryId !== categoryId) continue;
    const rawTitle = l.title as unknown;
    const titles =
      rawTitle && typeof rawTitle === 'object'
        ? Object.values(rawTitle as Record<string, unknown>)
        : [rawTitle];
    if (titles.some((x) => areTitlesDuplicate(title, x || ''))) return 'title';
    if (newHashes.length && l.photoHashes && (l.photoHashes as unknown[]).length) {
      const existing = l.photoHashes as string[];
      if (newHashes.some((h) => existing.some((o) => arePhotosDuplicate(h, o)))) {
        return 'photo';
      }
    }
  }
  return null;
}
