// Dlala publish page — client component.
//
// Mirrors js/publish.js (0.0.0.43) exactly:
//   - Mode toggle: sale / wanted (wanted forces wilaya 0, hides condition/
//     quantity/negotiable, budget label, default wanted image).
//   - Category-specific questions (12 categories with custom fields).
//   - Photo upload: max 10, client-side downscale (1600px), EXIF stripped
//     via canvas, WM-1 DLALA logo watermark baked in (drawWatermark),
//     W320 WebP thumbnail, uploads to R2 (NOT Firebase Storage).
//   - Validation: title ≤80, desc ≤2000, price ≤100M, 2-min cooldown.
//   - Publish via publishListing Cloud Function (CORS-simple POST).
//   - Edit mode (?edit=id): pre-fills, saves via direct Firestore update.
//   - Draft autosave to localStorage.
//   - Auth: must be signed in AND email verified (requireVerifiedAsync).

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// 12 Oct 2026 (Round 12): migrated to the modular Firebase SDK
// (@/lib/firebase; firebase-client users → getFirebaseCdn()). The
// photoVariants clear-half flow (Round 11) and the R2 presigned-upload
// flow are preserved exactly — see the comments at their sites.
import {
  useRequireAuth,
  LoadingSpinner,
  inputCls,
  btnCls,
  type FirebaseClient,
  type CompatUser,
} from '@/lib/firebase';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES, dzPriceWords } from '@/lib/categories';
import { pubT } from '@/lib/publish-strings';
import { useLang } from '@/lib/i18n';
import { uploadToR2, r2KeyFor, deleteR2Objects } from '@/lib/r2-upload';
import { encodePhoto } from '@/lib/stripExif';
import { checkDuplicates } from '@/lib/duplicates';
import { drawWatermark } from './watermark';

const MAX_PHOTOS = 10;
const PUBLISH_FN_URL =
  'https://europe-west3-dlala-85cea.cloudfunctions.net/publishListing';

// ---------- photo processing ----------

interface ProcessedPhoto {
  file: File; // downscaled main (WebP)
  thumb: File | null; // W320 WebP
  w640: File | null; // W640 WebP hero variant
  w1024: File | null; // W1024 WebP hero variant
  lqip: File | null; // W32 LQIP blur-up placeholder
  thumbIsMain: boolean; // R62 FIX 3: 320-variant skipped (canvas ≤320px — "no upscale"),
  // so the already-uploaded main photo doubles as the thumb (zero extra bytes).
  hash: string; // perceptual aHash (16 hex chars)
  previewUrl: string; // blob URL for preview
}

// Perceptual aHash (8x8, 16 hex chars) — verbatim port of market.js ahashOfBitmap.
// Computed from the already-decoded bitmap (same decode pass as the resize).
function ahashOfBitmap(bmp: ImageBitmap): string {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(bmp, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const gray: number[] = [];
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const g = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
    gray.push(g); sum += g;
  }
  const avg = sum / 64;
  let bits = '';
  for (const g of gray) bits += g >= avg ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.substr(i, 4), 2).toString(16);
  return hex;
}

function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { n += x & 1; x >>= 1; }
  }
  return n;
}

// Same Hamming ≤ 5 threshold as the cross-listing guard (market.js arePhotosDuplicate).
function arePhotosDuplicate(a: string, b: string): boolean {
  return hammingHex(a, b) <= 5;
}

// Drop duplicate photos WITHIN one ad before upload — verbatim port of
// publish.js dedupeWithinAd. Returns indices to keep.
function dedupeWithinAd(newHashes: string[], existingHashes: string[]): number[] {
  const seen: { h: string; idx: number }[] = [];
  (existingHashes || []).forEach((h) => { if (h) seen.push({ h, idx: -1 }); });
  const keep: number[] = [];
  (newHashes || []).forEach((h, i) => {
    let dupOf = -2;
    if (h) {
      for (const s of seen) {
        let isDup = false;
        try { isDup = arePhotosDuplicate(s.h, h); } catch { isDup = false; }
        if (isDup) { dupOf = s.idx; break; }
      }
    }
    if (dupOf !== -2) return; // duplicate — drop
    if (h) seen.push({ h, idx: i });
    keep.push(i);
  });
  return keep;
}

async function makeVariant(
  canvas: HTMLCanvasElement,
  baseName: string,
  width: number,
  suffix: string,
  quality?: number
): Promise<File | null> {
  const scale = width / canvas.width;
  if (scale >= 1) return null; // no upscale
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round(canvas.height * scale);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  // Per-width quality (legacy publish.js R11/Speed 29: 32px LQIP at 0.45)
  const q = quality ?? (width <= 48 ? 0.45 : width <= 320 ? 0.62 : width <= 640 ? 0.72 : 0.78);
  const blob = await new Promise<Blob | null>((res) =>
    c.toBlob(res, 'image/webp', q)
  );
  if (blob && blob.size)
    return new File([blob], `${baseName}${suffix}.webp`, { type: 'image/webp' });
  // R62 FIX 3: WebP encode unavailable (old browsers): JPEG fallback —
  // mirrors encodePhoto in @/lib/stripExif. The upload loop keys the variant
  // by the File's actual extension (like the main photo), and uploadToR2
  // serves file.type as the content-type, so the .jpg serves correctly.
  const jpeg = await new Promise<Blob | null>((res) =>
    c.toBlob(res, 'image/jpeg', q)
  );
  if (!jpeg) return null;
  return new File([jpeg], `${baseName}${suffix}.jpg`, { type: 'image/jpeg' });
}

async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // WM-1 (16 Sep 2026): DLALA logo watermark baked in at publish time —
  // js/publish.js parity. Runs before the encode, so the main photo and all
  // variants (cut below from this canvas) carry it. Must never break
  // publishing: drawWatermark swallows its own failures.
  drawWatermark(ctx, canvas.width, canvas.height);
  // aHash from the already-decoded bitmap (same decode pass — legacy perf opt)
  let hash = '';
  try { hash = ahashOfBitmap(bitmap); } catch { /* fail-open */ }
  if (bitmap.close) bitmap.close();

  const baseName = (file.name || 'photo').replace(/\.\w+$/, '').slice(0, 40);
  // R62 FIX 3: exact mirror of makeVariant's "no upscale" guard for width 320
  // (scale = 320 / canvas.width >= 1). When true, the main photo is already
  // ≤320px wide, so it doubles as the thumb in the upload loop.
  const thumbIsMain = canvas.width <= 320;
  const thumb = await makeVariant(canvas, baseName, 320, '-thumb');
  const w640 = await makeVariant(canvas, baseName, 640, '-w640');
  const w1024 = await makeVariant(canvas, baseName, 1024, '-w1024');
  const lqip = await makeVariant(canvas, baseName, 32, '-w32');

  // Encode main photo: WebP first, JPEG via canvas if WebP fails —
  // canvas re-encoding never carries EXIF. NEVER fall back to the original
  // file (that would leak EXIF/GPS into the upload). Mirrors
  // js/publish.js encodePhoto (0.0.0.1l FIX 19).
  const enc = await encodePhoto(canvas, 0.82);
  const main = new File([enc.blob], baseName + enc.ext, { type: enc.type });
  return {
    file: main,
    thumb,
    w640,
    w1024,
    lqip,
    thumbIsMain,
    hash,
    previewUrl: URL.createObjectURL(main),
  };
}

// ---------- category questions ----------

const PHONE_BRANDS = [
  'pbApple', 'pbSamsung', 'pbHonor', 'pbHuawei', 'pbXiaomi',
  'pbOppo', 'pbRealme', 'pbInfinix', 'pbTecno', 'pbOther',
];
const CAR_BRANDS = [
  'cbRenault', 'cbDacia', 'cbPeugeot', 'cbCitroen', 'cbFiat',
  'cbToyota', 'cbVolkswagen', 'cbHyundai', 'cbKia', 'cbNissan',
  'cbOther',
];

interface CatQuestionsProps {
  cat: string;
  answers: Record<string, string>;
  setAnswer: (k: string, v: string) => void;
}

function CatQuestions({ cat, answers, setAnswer }: CatQuestionsProps) {
  const { lang } = useLang();
  const t = useCallback((k: string) => pubT(k, lang), [lang]);
  const rowCls = 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4';
  const lblCls = 'block text-sm font-medium text-zinc-700 mb-1';
  const req = <span className="text-red-500"> *</span>;

  const sel = (
    id: string,
    label: string,
    options: [string, string][],
    required = false
  ) => (
    <div>
      <label htmlFor={id} className={lblCls}>
        {label}
        {required ? req : null}
      </label>
      <select
        id={id}
        className={inputCls}
        value={answers[id] || ''}
        onChange={(e) => setAnswer(id, e.target.value)}
        required={required}
      >
        <option value="">—</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  const inp = (
    id: string,
    label: string,
    type: string = 'text',
    required = false,
    maxLen?: number
  ) => (
    <div>
      <label htmlFor={id} className={lblCls}>
        {label}
        {required ? req : null}
      </label>
      <input
        id={id}
        type={type}
        dir={type === 'number' ? 'ltr' : undefined}
        maxLength={maxLen}
        className={inputCls}
        value={answers[id] || ''}
        onChange={(e) => setAnswer(id, e.target.value)}
        required={required}
      />
    </div>
  );

  if (cat === 'clothes' || cat === 'shoes') {
    return (
      <div className={rowCls}>
        {sel('qGender', t('qGender'), [
          ['cgMen', t('qMen')],
          ['cgWomen', t('qWomen')],
          ['cgKids', t('qKids')],
        ], true)}
      </div>
    );
  }

  if (cat === 'beauty') {
    return (
      <>
        <div className={rowCls}>
          {sel('qBeautyType', t('qProductType'), [
            ['btPerfume', t('btPerfume')],
            ['btSkincare', t('btSkincare')],
            ['btMakeup', t('btMakeup')],
            ['btHaircare', t('btHaircare')],
          ], true)}
          {inp('qBrand', t('qBrand'), 'text', true, 60)}
        </div>
        <div className={rowCls}>
          {sel('qBeautyCond', t('qCondition'), [
            ['new', t('condNew')],
            ['good', t('condGood')],
            ['used', t('condUsed')],
          ], true)}
          {inp('qVolume', t('qVolume'), 'text', false, 40)}
        </div>
      </>
    );
  }

  if (cat === 'phones') {
    const os = answers['qOs'] || '';
    const brands =
      os === 'osIos'
        ? ['pbApple']
        : os === 'osAndroid'
          ? PHONE_BRANDS.filter((b) => b !== 'pbApple')
          : PHONE_BRANDS;
    return (
      <>
        <div className={rowCls}>
          {sel('qOs', t('qOs'), [
            ['osAndroid', t('osAndroid')],
            ['osIos', t('osIos')],
          ], true)}
          {sel('qPhoneBrand', t('qBrand'), brands.map((b) => [b, t(b)] as [string, string]), true)}
        </div>
        <div className={rowCls}>
          {inp('qModel', t('qModel'), 'text', false, 60)}
          {inp('qStorage', t('qStorage'), 'text', false, 40)}
        </div>
        <div className={rowCls}>{inp('qBattery', t('qBattery'), 'text', false, 40)}</div>
      </>
    );
  }

  if (cat === 'cars') {
    const fuel = answers['qFuel'] || '';
    const isElectric = fuel === 'fuelElectric';
    return (
      <>
        <div className={rowCls}>
          {sel('qCarBrand', t('qBrand'), CAR_BRANDS.map((b) => [b, t(b)] as [string, string]), true)}
          {inp('qCarModel', t('qModel'), 'text', false, 60)}
        </div>
        <div className={rowCls}>
          {inp('qYear', t('qYear'), 'number', true)}
          {inp('qMileage', t('qMileage'), 'number', true)}
        </div>
        <div className={rowCls}>
          {sel('qFuel', t('qFuel'), [
            ['fuelPetrol', t('fuelPetrol')],
            ['fuelDiesel', t('fuelDiesel')],
            ['fuelGas', t('fuelGas')],
            ['fuelElectric', t('fuelElectric')],
          ], true)}
          {!isElectric &&
            sel('qGear', t('qGear'), [
              ['gearManual', t('gearManual')],
              ['gearAuto', t('gearAuto')],
            ], true)}
        </div>
      </>
    );
  }

  if (cat === 'velos' || cat === 'trottinettes') {
    const isVelo = cat === 'velos';
    const typeKey = isVelo ? 'qVeloType' : 'qTrotType';
    const typeVal = answers[typeKey] || '';
    const showBatt =
      (isVelo && typeVal === 'veloElectric') ||
      (!isVelo && typeVal === 'trotElectric');
    return (
      <>
        <div className={rowCls}>
          {isVelo
            ? sel(typeKey, t('qVeloType'), [
                ['veloMountain', t('veloMountain')],
                ['veloCity', t('veloCity')],
                ['veloRace', t('veloRace')],
                ['veloElectric', t('veloElectric')],
              ], true)
            : sel(typeKey, t('qTrotType'), [
                ['trotElectric', t('trotElectric')],
                ['trotManual', t('trotManual')],
              ], true)}
          {showBatt &&
            sel('qBatteryRange', t('qBatteryRange'), [
              ['battUnder20', t('battUnder20')],
              ['batt20to40', t('batt20to40')],
              ['battOver40', t('battOver40')],
            ], true)}
        </div>
        <div className={rowCls}>
          {isVelo
            ? inp('qWheelSize', t('qWheelSize'), 'text', false, 20)
            : inp('qTrotBrand', t('qBrand'), 'text', false, 60)}
        </div>
      </>
    );
  }

  if (cat === 'machines') {
    return (
      <>
        <div className={rowCls}>
          {sel('qMachineDomain', t('qMachineDomain'), [
            ['machAgri', t('machAgri')],
            ['machIndustrial', t('machIndustrial')],
            ['machConstruction', t('machConstruction')],
            ['machOther', t('machOther')],
          ], true)}
          {inp('qMachineBrand', t('qBrand'), 'text', false, 60)}
        </div>
        <div className={rowCls}>{inp('qMachineYear', t('qMachineYear'), 'number')}</div>
      </>
    );
  }

  if (cat === 'spareparts') {
    return (
      <div className={rowCls}>
        {sel('qSpareFor', t('qSpareFor'), [
          ['spareCars', t('spareCars')],
          ['spareMoto', t('spareMoto')],
          ['spareVelo', t('spareVelo')],
          ['spareMachines', t('spareMachines')],
          ['spareOther', t('spareOther')],
        ], true)}
        {inp('qSpareModel', t('qSpareModel'), 'text', false, 80)}
      </div>
    );
  }

  if (cat === 'jobs') {
    const jt = answers['qJobType'] || '';
    return (
      <>
        <div className={rowCls}>
          {sel('qJobType', t('qJobType'), [
            ['jobOffer', t('jobOffer')],
            ['jobSeeker', t('jobSeeker')],
          ], true)}
        </div>
        {jt === 'jobOffer' && (
          <>
            <div className={rowCls}>
              {inp('qJobTitle', t('qJobTitle'), 'text', true, 80)}
              {inp('qSector', t('qSector'), 'text', false, 80)}
            </div>
            <div className={rowCls}>
              {sel('qContract', t('qContract'), [
                ['contractPartTime', t('contractPartTime')],
                ['contractTemp', t('contractTemp')],
                ['contractFull', t('contractFull')],
              ], true)}
              {inp('qSalary', t('qSalary'), 'number')}
            </div>
          </>
        )}
        {jt === 'jobSeeker' && (
          <>
            <div className={rowCls}>
              {inp('qProfession', t('qProfession'), 'text', true, 80)}
              {inp('qExperience', t('qExperience'), 'number', true)}
            </div>
            <div className={rowCls}>
              {sel('qAvailability', t('qAvailability'), [
                ['availNow', t('availNow')],
                ['availMonth', t('availMonth')],
              ], true)}
            </div>
          </>
        )}
      </>
    );
  }

  if (cat === 'realestate') {
    const ptype = answers['qPropertyType'] || '';
    const isLand = ptype === 'reLand';
    return (
      <>
        <div className={rowCls}>
          {sel('qPurpose', t('qListingPurpose'), [
            ['reSell', t('reSell')],
            ['reRent', t('reRent')],
          ], true)}
          {sel('qPropertyType', t('qPropertyType'), [
            ['reLand', t('reLand')],
            ['reVilla', t('reVilla')],
            ['reHouse', t('reHouse')],
            ['reApartment', t('reApartment')],
          ], true)}
        </div>
        <div className={rowCls}>
          {!isLand && inp('qRooms', t('qRooms'), 'number', true)}
          {inp('qArea', t('qArea'), 'number', true)}
        </div>
      </>
    );
  }

  if (cat === 'services') {
    return (
      <div className={rowCls}>
        {sel('qPricing', t('qPricing'), [
          ['pricingFixed', t('pricingFixed')],
          ['pricingNegotiable', t('pricingNegotiable')],
          ['pricingHourly', t('pricingHourly')],
        ], true)}
      </div>
    );
  }

  return null;
}

// ---------- main page ----------

function PublishForm({
  user,
  client,
  editId,
  initialMode,
}: {
  user: CompatUser;
  client: FirebaseClient;
  editId: string | null;
  initialMode: string | null;
}) {
  const { db, fsMod, authMod } = client;
  const { lang } = useLang();
  const t = useCallback((k: string) => pubT(k, lang), [lang]);
  // Draft restore — read once via lazy initializer (client-only, no effect)
  // BE-4 (R16, 18 Oct 2026): the draft key includes the user UID — the
  // unkeyed key leaked one user's title/desc/price/answers to the next
  // user on a shared device/browser (and survived account deletion).
  const draftKey = (uid: string) => `dlala_publish_draft_${uid}`;
  const readDraft = (uid: string) => {
    if (editId || typeof window === 'undefined') return null;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(uid)) || 'null');
      // 11 Oct 2026: 7-day TTL — stale drafts must not resurrect.
      if (!d || (d.ts && Date.now() - d.ts > 7 * 24 * 3600 * 1000)) return null;
      return d;
    } catch {
      return null;
    }
  };
  const [isWanted, setIsWanted] = useState(() => readDraft(user.uid)?.isWanted ?? initialMode === 'wanted');
  const router = useRouter();
  const [title, setTitle] = useState(() => readDraft(user.uid)?.title || '');
  const [cat, setCat] = useState(() => readDraft(user.uid)?.cat || '');
  // 13 Oct 2026 (Round 16, BUG 4): wanted mode stores wilayaCode 0
  // ("all wilayas") — the legacy js/publish.js parity value. Opening
  // /publish?mode=wanted left wilaya='' with the select hidden, so
  // validate() always failed wantedWilayaAutoError. Default to '0' for
  // wanted initial mode (no draft).
  const [wilaya, setWilaya] = useState(() => {
    const d = readDraft(user.uid);
    if (d?.wilaya) return d.wilaya;
    if (d) return ''; // draft without wilaya — keep as-is
    return initialMode === 'wanted' ? '0' : '';
  });
  // 13 Oct 2026 (Round 16, T7b): wanted mode always carries wilaya '0'
  // ("all wilayas", legacy js/publish.js parity) for NEW publishes. In
  // EDIT mode the stored wilaya is used instead (R52-B2: jobSeeker wanted
  // ads may carry a concrete wilaya per CF W-02 — forcing '0' silently
  // wiped it on every edit save).
  const [price, setPrice] = useState(() => readDraft(user.uid)?.price || '');
  const [condition, setCondition] = useState(() => readDraft(user.uid)?.condition || '');
  const [qty, setQty] = useState(() => readDraft(user.uid)?.qty || '1');
  const [negotiable, setNegotiable] = useState(() => readDraft(user.uid)?.negotiable || false);
  const [desc, setDesc] = useState(() => readDraft(user.uid)?.desc || '');
  // R26-1 (24 Oct 2026): the description exactly as stored, captured by the
  // edit-mode loader. validate() grandfathers an UNCHANGED stored value —
  // pipeline-imported listings can carry descriptions under the publish-time
  // 20-char minimum (or empty), and re-validating the stored text made 72
  // live listings un-editable (every save, price edits included, bounced).
  const [origDesc, setOrigDesc] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(() => readDraft(user.uid)?.answers || {});
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<{ url: string; hash: string; thumb: string | null }[]>([]);
  const [removedExisting, setRemovedExisting] = useState<string[]>([]);
  const [existingDirty, setExistingDirty] = useState(false);
  const [photoWarn, setPhotoWarn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setAnswer = useCallback((k: string, v: string) => {
    setAnswers((a) => {
      const next = { ...a, [k]: v };
      // AT-7 (R12, 18 Oct 2026): clear stale gearbox when switching to
      // electric — server rejects 'answers.gear must not be set for
      // electric cars'.
      if (k === 'qFuel' && v === 'fuelElectric') delete next['qGear'];
      // DE-3 (R34, 18 Oct 2026): clear stale phone brand when switching
      // OS — e.g. iOS→Android left qPhoneBrand='pbApple' (not in Android
      // options) → blank select + mismatched payload.
      if (k === 'qOs') {
        const b = next['qPhoneBrand'];
        if (v === 'osAndroid' && b === 'pbApple') delete next['qPhoneBrand'];
        if (v === 'osIos' && b && b !== 'pbApple') delete next['qPhoneBrand'];
      }
      // R52-B3 (18 Oct 2026): clear stale dependent-branch answers on
      // select switches — the hidden branch's fields stayed in `answers`
      // and were saved into the payload (e.g. rooms=4 on a LAND ad,
      // contract/salary on a jobSeeker ad, batteryRange on a manual
      // trottinette). Same class as DE-3/AT-7 above.
      if (k === 'qPropertyType' && v === 'reLand') delete next['qRooms'];
      if (k === 'qJobType') {
        if (v === 'jobSeeker') {
          delete next['qJobTitle']; delete next['qContract'];
          delete next['qSalary']; delete next['qSector'];
        } else if (v === 'jobOffer') {
          delete next['qProfession']; delete next['qExperience'];
          delete next['qAvailability'];
        }
      }
      if (k === 'qVeloType' && v !== 'veloElectric') delete next['qBatteryRange'];
      if (k === 'qTrotType' && v !== 'trotElectric') delete next['qBatteryRange'];
      return next;
    });
  }, []);

  // Draft autosave
  useEffect(() => {
    if (editId) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey(user.uid),
          // 11 Oct 2026: save all fields + TTL (was dropping condition/isWanted).
          JSON.stringify({ title, cat, wilaya, price, desc, answers, condition, qty, negotiable, isWanted, ts: Date.now() })
        );
      } catch { /* ignore */ }
    }, 1000);
    return () => clearTimeout(timer);
  }, [title, cat, wilaya, price, desc, answers, condition, qty, negotiable, isWanted, editId, user.uid]);

  // Edit mode: load existing listing
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const snap = await fsMod.getDoc(fsMod.doc(db, 'listings', editId));
        if (!snap.exists()) {
          setError(t('editLoadError'));
          return;
        }
        const d = snap.data()!;
        if (d.sellerId !== user.uid) {
          setError(t('editError'));
          return;
        }
        const lang = 'ar';
        setTitle((d.title as Record<string, string>)?.[lang] || '');
        const storedDesc = (d.description as Record<string, string>)?.[lang] || '';
        setDesc(storedDesc);
        setOrigDesc(storedDesc);
        setCat((d.categoryId as string) || '');
        setWilaya(String(d.wilayaCode ?? ''));
        setPrice(String(d.price ?? ''));
        setCondition((d.condition as string) || '');
        setQty(String(d.quantity ?? 1));
        setNegotiable(!!d.negotiable);
        setIsWanted(!!d.isWanted);
        if (d.answers && typeof d.answers === 'object') {
          const raw = d.answers as Record<string, string>;
          // Map Firestore keys (brand, year...) to form keys (qCarBrand, qYear...)
          // for edit-mode pre-fill. Reverse of the publish-time mapping.
          const mapped: Record<string, string> = { ...raw };
          // Cars
          if (raw.brand && !raw.qCarBrand) mapped.qCarBrand = raw.brand;
          if (raw.year && !raw.qYear) mapped.qYear = raw.year;
          if (raw.mileage && !raw.qMileage) mapped.qMileage = raw.mileage;
          if (raw.fuel && !raw.qFuel) mapped.qFuel = raw.fuel;
          if (raw.gear && !raw.qGear) mapped.qGear = raw.gear;
          if (raw.model && !raw.qModel) mapped.qModel = raw.model;
          // Phones
          if (raw.os && !raw.qOs) mapped.qOs = raw.os;
          if (raw.storage && !raw.qStorage) mapped.qStorage = raw.storage;
          // 11 Oct 2026: map ALL required keys (was cars/phones only — 11
          // categories couldn't be edited at all).
          if (raw.gender && !raw.qGender) mapped.qGender = raw.gender;
          if (raw.type && !raw.qBeautyType) mapped.qBeautyType = raw.type;
          if (raw.brand && !raw.qBrand) mapped.qBrand = raw.brand;
          if (raw.condition && !raw.qBeautyCond) mapped.qBeautyCond = raw.condition;
          if (raw.brand && !raw.qPhoneBrand) mapped.qPhoneBrand = raw.brand;
          if (raw.veloType && !raw.qVeloType) mapped.qVeloType = raw.veloType;
          if (raw.trotType && !raw.qTrotType) mapped.qTrotType = raw.trotType;
          if (raw.domain && !raw.qMachineDomain) mapped.qMachineDomain = raw.domain;
          if (raw.forVehicle && !raw.qSpareFor) mapped.qSpareFor = raw.forVehicle;
          if (raw.jobType && !raw.qJobType) mapped.qJobType = raw.jobType;
          if (raw.purpose && !raw.qPurpose) mapped.qPurpose = raw.purpose;
          if (raw.propertyType && !raw.qPropertyType) mapped.qPropertyType = raw.propertyType;
          if (raw.area && !raw.qArea) mapped.qArea = raw.area;
          if (raw.pricing && !raw.qPricing) mapped.qPricing = raw.pricing;
          // DK-1 (R36, 18 Oct 2026): edit-mode prefill omitted required
          // category answers — jobs (qJobTitle, qContract, qProfession,
          // qExperience, qAvailability), realestate (qRooms), velos/trott
          // (qBatteryRange). Fill ALL remaining form fields too so no
          // category opens edit mode with empty required fields.
          if (raw.jobTitle && !raw.qJobTitle) mapped.qJobTitle = raw.jobTitle;
          if (raw.contract && !raw.qContract) mapped.qContract = raw.contract;
          if (raw.profession && !raw.qProfession) mapped.qProfession = raw.profession;
          if (raw.experience && !raw.qExperience) mapped.qExperience = raw.experience;
          if (raw.availability && !raw.qAvailability) mapped.qAvailability = raw.availability;
          if (raw.salary && !raw.qSalary) mapped.qSalary = raw.salary;
          if (raw.sector && !raw.qSector) mapped.qSector = raw.sector;
          if (raw.rooms && !raw.qRooms) mapped.qRooms = raw.rooms;
          if (raw.batteryRange && !raw.qBatteryRange) mapped.qBatteryRange = raw.batteryRange;
          if (raw.battery && !raw.qBattery) mapped.qBattery = raw.battery;
          if (raw.model && !raw.qCarModel) mapped.qCarModel = raw.model;
          if (raw.year && !raw.qMachineYear) mapped.qMachineYear = raw.year;
          if (raw.compatibleModel && !raw.qSpareModel) mapped.qSpareModel = raw.compatibleModel;
          if (raw.volume && !raw.qVolume) mapped.qVolume = raw.volume;
          if (raw.wheelSize && !raw.qWheelSize) mapped.qWheelSize = raw.wheelSize;
          if (raw.brand && !raw.qMachineBrand) mapped.qMachineBrand = raw.brand;
          if (raw.brand && !raw.qTrotBrand) mapped.qTrotBrand = raw.brand;
          setAnswers(mapped);
        }
        // Fix 7: load existing photos with hashes + thumbs (legacy editListing.photoUrls)
        // 12 Oct 2026: filter out dzdlala.com default_ads URLs — they fail v122
        // listingPhotoUrlsOk (not R2/Storage URLs) and would block the save.
        const pUrls = (Array.isArray(d.photoUrls) ? d.photoUrls : []).filter(
          (u: string) => typeof u === 'string' && !u.includes('dzdlala.com/img/default_ads/')
        );
        const pHashes = Array.isArray(d.photoHashes) ? d.photoHashes : [];
        const pThumbs = Array.isArray(d.photo_thumbs) ? d.photo_thumbs : [];
        setExistingPhotos(
          pUrls.map((u: string, i: number) => ({
            url: u,
            hash: pHashes[i] || '',
            thumb: pThumbs[i] || null,
          }))
        );
        setRemovedExisting([]);
        setExistingDirty(false);
      } catch {
        setError(t('editLoadError'));
      }
    })();
  }, [editId, client, db, fsMod, user.uid, t]);

  const onPickPhotos = async (files: FileList | null) => {
    if (!files) return;
    setPhotoWarn(null);
    const slots = MAX_PHOTOS - photos.length - existingPhotos.length;
    const allPicked = Array.from(files);
    // Fix 1: JS file type validation (in addition to accept="image/*")
    const notImages = allPicked.filter((f) => !f.type || !f.type.startsWith('image/'));
    let picked = allPicked.filter((f) => f.type && f.type.startsWith('image/'));
    // HEIC/HEIF rejected with dedicated message (not decodable by canvas)
    const heic = picked.filter((f) =>
      /heic|heif/i.test(f.type) || /\.heic?$/i.test(f.name)
    );
    picked = picked.filter((f) => !heic.includes(f));
    // Cap: files past MAX_PHOTOS are ignored (legacy: "files past the cap are never attempted")
    const ignored = Math.max(0, picked.length - Math.max(0, slots));
    picked = picked.slice(0, Math.max(0, slots));
    // Fix 6: visible photoWarn feedback (legacy renderPhotoNotice)
    const warnParts: string[] = [];
    if (notImages.length) {
      warnParts.push(t('photoSkipped').replace('{name}', notImages.map((f) => f.name || '?').join(', ')));
    }
    if (heic.length) {
      warnParts.push(t('photoHeic').replace('{name}', heic.map((f) => f.name || '?').join(', ')));
    }
    if (ignored > 0) {
      warnParts.push(t('photoLimitReached').replace('{n}', String(ignored)));
    }
    if (warnParts.length) setPhotoWarn(warnParts.join(' '));
    if (!picked.length) return;
    setProgress(t('progPreparing').replace('{x}', '0').replace('{y}', String(picked.length)));
    const done: ProcessedPhoto[] = [];
    const skippedNames: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      try {
        const p = await processPhoto(picked[i]);
        done.push(p);
      } catch {
        skippedNames.push(picked[i].name || '?');
      }
      setProgress(
        t('progPreparing')
          .replace('{x}', String(i + 1))
          .replace('{y}', String(picked.length))
      );
    }
    if (skippedNames.length) {
      setPhotoWarn((prev) => {
        const msg = t('photoSkipped').replace('{name}', skippedNames.join(', '));
        return prev ? prev + ' ' + msg : msg;
      });
    }
    // Fix 5: within-ad dedupe — drop perceptual duplicates (Hamming ≤ 5)
    // against existing photos and each other (legacy dedupeWithinAd).
    let final = done;
    if (done.length) {
      const keepIdx = dedupeWithinAd(
        done.map((p) => p.hash),
        [...existingPhotos.map((p) => p.hash), ...photos.map((p) => p.hash)]
      );
      final = keepIdx.map((ki) => done[ki]);
    }
    setPhotos((p) => [...p, ...final].slice(0, MAX_PHOTOS));
    setProgress(null);
  };

  const removePhoto = (i: number) => {
    setPhotos((p) => {
      const pp = [...p];
      const [rm] = pp.splice(i, 1);
      try { URL.revokeObjectURL(rm.previewUrl); } catch { /* ignore */ }
      return pp;
    });
  };

  const movePhoto = (i: number, d: number) => {
    setPhotos((p) => {
      const pp = [...p];
      const j = i + d;
      if (j < 0 || j >= pp.length) return p;
      [pp[i], pp[j]] = [pp[j], pp[i]];
      return pp;
    });
  };

  // Existing photo editor (edit mode) — legacy renderPhotoEditor parity:
  // reorder, set-as-cover (photoUrls[0] is the cover), remove (confirm).
  const moveExisting = (i: number, d: number) => {
    setExistingDirty(true);
    setExistingPhotos((p) => {
      const pp = [...p];
      const j = i + d;
      if (j < 0 || j >= pp.length) return p;
      [pp[i], pp[j]] = [pp[j], pp[i]];
      return pp;
    });
  };

  const setExistingCover = (i: number) => {
    if (i <= 0) return;
    setExistingDirty(true);
    setExistingPhotos((p) => {
      const pp = [...p];
      const [it] = pp.splice(i, 1);
      pp.unshift(it);
      return pp;
    });
  };

  const removeExisting = (i: number) => {
    // 11 Oct 2026: removed window.confirm — hangs headless browsers.
    // Photo removal is reversible (user can re-upload before saving).
    setExistingDirty(true);
    setExistingPhotos((p) => {
      const pp = [...p];
      const [rm] = pp.splice(i, 1);
      if (rm) {
        setRemovedExisting((r) => {
          const urls = [...r, rm.url];
          if (rm.thumb) urls.push(rm.thumb);
          return urls;
        });
      }
      return pp;
    });
  };

  const fail = (m: string) => {
    setError(m);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validate = (): boolean => {
    if (!title.trim()) { fail(t('errorTitleRequired')); return false; }
    if (title.trim().length > 80) { fail(t('errorTitleTooLong')); return false; }
    // CL-5 (18 Oct 2026): minimum lengths — a 1-char title/description
    // passes the "required" check but is useless. 10/20 chars minimum.
    if (title.trim().length < 10) { fail(t('errorTitleTooShort')); return false; }
    // R26-1 (24 Oct 2026): in EDIT mode, an unchanged stored description is
    // grandfathered — the publish-time required/min/max checks below apply
    // only when the user actually edited the text (or in publish mode). The
    // stored value is never rewritten by this: the seller's own words pass
    // through untouched, exactly as the rules' owner-edit path allows them
    // (trilingualOk enforces only the 5000-char cap + XSS filter, no
    // minimum). A CHANGED description is validated in full.
    const descIsStored =
      !!editId && origDesc !== null && desc.trim() === origDesc.trim();
    if (!descIsStored) {
      if (!desc.trim()) { fail(t('errorDescRequired')); return false; }
      if (desc.trim().length > 2000) { fail(t('errorDescTooLong')); return false; }
      if (desc.trim().length < 20) { fail(t('errorDescTooShort')); return false; }
    }
    if (!cat) { fail(t('errorCatRequired')); return false; }
    const isJobsCat = cat === 'jobs';
    const priceNum = price.trim() === '' ? NaN : Number(price);
    // BE-5 (R16, 18 Oct 2026): 0 DZD is not a valid price — the
    // negotiable convention is 1 DZD (Ouedkniss pipeline rule).
    // R26-4 (24 Oct 2026): in WANTED mode the same `price` state backs the
    // «الميزانية» (budget) input — the refusal must name the budget, not a
    // "price" the wanted form doesn't have. Semantics unchanged (the amount
    // stays mandatory ≥ 1, integer, ≤ 100M in both modes).
    if (!isJobsCat && !(priceNum >= 1)) { fail(t(isWanted ? 'errorBudgetMin' : 'errorPriceMin')); return false; }
    // BN-1 (R19, 18 Oct 2026): DZD prices must be integers — a fraction
    // (e.g. 99.5) would store as a Firestore doubleValue and break
    // centime-exact arithmetic once money moves.
    if (!isJobsCat && !Number.isInteger(priceNum)) { fail(t(isWanted ? 'errorBudgetInteger' : 'errorPriceInteger')); return false; }
    if (!isJobsCat && priceNum > 100000000) { fail(t(isWanted ? 'errorBudgetTooHigh' : 'errorPriceTooHigh')); return false; }
    // Wanted publishes always carry wilaya 0 (forced at save) — no check
    // needed; the value cannot be stale by construction.
    if (!isWanted && !(Number(wilaya) >= 1)) { fail(t('errorRequired')); return false; }
    // Category questions: required ones
    const requiredByCat: Record<string, string[]> = {
      clothes: ['qGender'],
      shoes: ['qGender'],
      beauty: ['qBeautyType', 'qBrand', 'qBeautyCond'],
      phones: ['qOs', 'qPhoneBrand'],
      cars: ['qCarBrand', 'qYear', 'qMileage', 'qFuel'],
      velos: ['qVeloType'],
      trottinettes: ['qTrotType'],
      machines: ['qMachineDomain'],
      spareparts: ['qSpareFor'],
      jobs: ['qJobType'],
      realestate: ['qPurpose', 'qPropertyType', 'qArea'],
      services: ['qPricing'],
    };
    const req = requiredByCat[cat] || [];
    for (const k of req) {
      if (!answers[k]) { fail(t('errorRequired')); return false; }
    }
    // DE-1 (R34, 18 Oct 2026): restore conditional required category
    // questions (legacy validateCatQuestions parity) — they render with
    // red asterisks but passed empty without these checks.
    if (cat === 'jobs') {
      const jt = answers['qJobType'] || '';
      if (jt === 'jobOffer') {
        if (!answers['qJobTitle']) { fail(t('errorRequired')); return false; }
        if (!answers['qContract']) { fail(t('errorRequired')); return false; }
      } else if (jt === 'jobSeeker') {
        if (!answers['qProfession']) { fail(t('errorRequired')); return false; }
        if (!answers['qExperience']) { fail(t('errorRequired')); return false; }
        if (!answers['qAvailability']) { fail(t('errorRequired')); return false; }
      }
    }
    if (cat === 'realestate' && answers['qPropertyType'] !== 'reLand') {
      if (!answers['qRooms']) { fail(t('errorRequired')); return false; }
    }
    if ((cat === 'velos' && answers['qVeloType'] === 'veloElectric') ||
        (cat === 'trottinettes' && answers['qTrotType'] === 'trotElectric')) {
      if (!answers['qBatteryRange']) { fail(t('errorRequired')); return false; }
    }
    // Legacy parity: numeric category answers must be >= 0.
    for (const k of ['qRooms', 'qArea', 'qExperience']) {
      if (answers[k] !== undefined && answers[k] !== '' && Number(answers[k]) < 0) {
        fail(t('errorRequired')); return false;
      }
    }
    if (cat === 'cars' && answers['qFuel'] !== 'fuelElectric' && !answers['qGear']) {
      fail(t('errorRequired')); return false;
    }
    // DK-4 (R36, 18 Oct 2026): client-side non-negative salary check —
    // a negative salary passed the client and the CF rejected it with a
    // raw English message.
    if (cat === 'jobs' && answers['qSalary'] !== undefined && answers['qSalary'] !== '' && Number(answers['qSalary']) < 0) {
      fail(t('errSalaryNegative')); return false;
    }
    // Year range validation (1990–currentYear+1)
    const curYear = new Date().getFullYear() + 1;
    if (cat === 'cars' && answers['qYear']) {
      const y = Number(answers['qYear']);
      // DK-3 (R36, 18 Oct 2026): client-side integer check — 2019.5 passed
      // the client while the CF rejected it with raw English.
      if (!Number.isInteger(y)) { fail(t('errYearInteger')); return false; }
      if (!(y >= 1990 && y <= curYear)) {
        fail(t('errYearRange').replace('{min}', '1990').replace('{max}', String(curYear)));
        return false;
      }
    }
    if (cat === 'machines' && answers['qMachineYear']) {
      const y = Number(answers['qMachineYear']);
      // DK-3 (R36, 18 Oct 2026): same integer check for the machine year.
      if (!Number.isInteger(y)) { fail(t('errYearInteger')); return false; }
      if (!(y >= 1990 && y <= curYear)) {
        fail(t('errYearRange').replace('{min}', '1990').replace('{max}', String(curYear)));
        return false;
      }
    }
    // Condition required (except beauty/services/jobs/wanted).
    // AT-8 (R12, 18 Oct 2026): land was exempted client-side but the
    // server requires condition for land — removed the land exemption
    // to match the server.
    if (!isWanted && !['beauty', 'services', 'jobs'].includes(cat)) {
      if (!condition) { fail(t('selectCondition')); return false; }
    }
    // 11 Oct 2026: photo count guard — max enforced only at pick-time (race).
    const totalPhotos = photos.length + existingPhotos.length;
    // 12 Oct 2026: dedicated message (was generic error).
    // DE-2 (R34, 18 Oct 2026): {n} = excess photos over the cap (was leaked raw).
    if (totalPhotos > 10) { fail(t('photoLimitReached').replace('{n}', String(totalPhotos - 10))); return false; }
    // AT-5 (R12, 18 Oct 2026): server caps quantity at 99 + integer
    // required (MAX_QUANTITY, D-3 Zak decision). Reject client-side
    // before the upload instead of failing server-side after.
    if (!isWanted) {
      const qtyNum = Number(qty);
      if (qty.trim() !== '' && (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 99)) {
        fail(t('errorQtyRange')); return false;
      }
    }
    // AT-6 (R12, 18 Oct 2026): server requires integer mileage 0–9,999,999.
    if (cat === 'cars' && answers['qMileage']) {
      const milNum = Number(answers['qMileage']);
      if (!Number.isInteger(milNum) || milNum < 0 || milNum > 9999999) {
        fail(t('errorMileageRange')); return false;
      }
    }
    // AT-1 (R12, 18 Oct 2026): server F-14 rejects sale ads with zero
    // photos AFTER the upload progress — block client-side for good UX.
    // BE-1 (R16, 18 Oct 2026): the default-image fallback at submit (app
    // parity) injects a server-allowlisted dzdlala.com image for jobs
    // seeker/offer and wanted ads — those ads legitimately publish with
    // 0 picked photos, so exempt them here. Before this, AT-1 fired first
    // and the seeker/offer branches were unreachable dead code (also
    // wrongly blocked editing a job-offer ad that carries the default
    // image, since edit prefill filters default_ads URLs out of
    // existingPhotos).
    const jtBE1 = answers['qJobType'];
    const getsDefaultImage =
      (cat === 'jobs' && (jtBE1 === 'jobSeeker' || jtBE1 === 'jobOffer')) || isWanted;
    if (!isWanted && totalPhotos === 0 && !getsDefaultImage) { fail(t('errorPhotoRequired')); return false; }
    return true;
  };

  // Upload new photos to R2: main + w320/w640/w1024/w32 variants.
  // Returns { urls, hashes, thumbs, variantsOk } aligned 1:1 (legacy
  // uploadPhotos parity).
  // 12 Oct 2026: variant uploads RETRY transient failures (were single-
  // attempt best-effort, silently swallowed). A photo-changing edit leaves
  // photoVariants=true on the doc — the field is NOT in the v122/v123
  // owner-edit allowlist, so the client cannot clear it — and missing
  // variant files would 404 the derived URLs (BlurUpImage). variantsOk[i]
  // is false only after all retries failed; the edit flow refuses to save
  // a photo set it knows is stale.
  const uploadNewPhotos = async (
    list: ProcessedPhoto[],
    uid: string,
    listingId: string,
    idToken: string
  ): Promise<{ urls: string[]; hashes: string[]; thumbs: (string | null)[]; variantsOk: boolean[] }> => {
    const urls: string[] = [];
    const hashes: string[] = [];
    const thumbs: (string | null)[] = [];
    const variantsOk: boolean[] = [];
    if (!list.length) return { urls, hashes, thumbs, variantsOk };
    setProgress(t('progUploading').replace('{x}', '0').replace('{y}', String(list.length)));
    // 12 Oct 2026: retry helper for variant PUTs — transient R2/network
    // failures must not silently leave photoVariants=true with no files.
    // Returns the public URL on success, null after all retries failed.
    const putWithRetry = async (file: File, key: string): Promise<string | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await uploadToR2(file, key, idToken);
          return res.publicUrl;
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      return null;
    };
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const ts = Date.now();
      // 11 Oct 2026: use actual file extension — was hardcoded .webp but
      // encodePhoto falls back to .jpg on browsers without WebP.
      const ext = p.file.name.match(/\.\w+$/)?.[0] || '.webp';
      const key = r2KeyFor(uid, listingId, `${ts}_${i}${ext}`);
      const { publicUrl } = await uploadToR2(p.file, key, idToken);
      urls.push(publicUrl);
      // AT-9 (R12, 18 Oct 2026): an empty aHash ('') fails the server's
      // validatePhotoHashes (/^[0-9a-fA-F]{16}$/) and blocks the ENTIRE
      // publish. Substitute a random 16-hex placeholder — it preserves
      // 1:1 url/hash alignment, passes validation, and (being random)
      // cannot falsely match another photo's perceptual hash.
      let h = p.hash || '';
      if (!/^[0-9a-fA-F]{16}$/.test(h)) {
        h = [...crypto.getRandomValues(new Uint8Array(8))]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
      hashes.push(h);
      // Variants: w320 thumb (photo_thumbs content), w640/w1024 heroes, w32 LQIP.
      // 14 Oct 2026 (R62 FIX 3): variant keys use the File's actual extension —
      // makeVariant now emits .jpg when the browser has no WebP encoder.
      const vext = (f: File) => f.name.match(/\.\w+$/)?.[0] || '.webp';
      let photoOk = true;
      if (p.thumb) {
        const thumbUrl = await putWithRetry(p.thumb, r2KeyFor(uid, listingId, `w320_${ts}_${i}${vext(p.thumb)}`));
        thumbs.push(thumbUrl);
        if (!thumbUrl) photoOk = false;
      } else if (p.thumbIsMain) {
        // Root cause of the webp-less "thumb" (R62 FIX 3): makeVariant returns
        // null when the source is already ≤320px wide ("no upscale"), and R2
        // has no server-side thumb generator to heal the null. The main photo
        // IS correctly sized then, so it doubles as the thumb — zero extra
        // bytes, zero extra uploads — instead of a permanent null.
        thumbs.push(publicUrl);
      } else {
        thumbs.push(null);
      }
      const w640Url = p.w640 ? await putWithRetry(p.w640, r2KeyFor(uid, listingId, `w640_${ts}_${i}${vext(p.w640)}`)) : '';
      const w1024Url = p.w1024 ? await putWithRetry(p.w1024, r2KeyFor(uid, listingId, `w1024_${ts}_${i}${vext(p.w1024)}`)) : '';
      const w32Url = p.lqip ? await putWithRetry(p.lqip, r2KeyFor(uid, listingId, `w32_${ts}_${i}${vext(p.lqip)}`)) : '';
      if (p.w640 && !w640Url) photoOk = false;
      if (p.w1024 && !w1024Url) photoOk = false;
      if (p.lqip && !w32Url) photoOk = false;
      variantsOk.push(photoOk);
      setProgress(
        t('progUploading')
          .replace('{x}', String(i + 1))
          .replace('{y}', String(list.length))
      );
    }
    return { urls, hashes, thumbs, variantsOk };
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    // Verified email required
    // R52: reload the Auth user first — user.emailVerified is cached on the
    // JS object and getIdToken() does NOT refresh it; a user who verified
    // in another tab would otherwise be wrongly blocked here (my-listings
    // already follows this pattern).
    try { await authMod.reload(user); } catch { /* ignore */ }
    try { await authMod.getIdToken(user, true); } catch { /* ignore */ }
    if (!user.emailVerified) {
      fail(t('mustLogin'));
      return;
    }

    // Cooldown (new publishes only)
    if (!editId) {
      const lastPub = Number(localStorage.getItem('dlala_last_publish') || 0);
      if (Date.now() - lastPub < 120000) {
        const s = Math.ceil((120000 - (Date.now() - lastPub)) / 1000);
        fail(t('publishCooldown').replace('{s}', String(s)));
        return;
      }
    }

    if (!validate()) return;

    // Anti-duplicate pre-check (js/publish.js checkDuplicates parity):
    // near-duplicate titles or already-used photos in the seller's OWN
    // live listings of the same category block publish/edit before any
    // upload happens. Fails open (checkDuplicates returns null) on timeout.
    setProgress(t('progChecking'));
    const dup = await checkDuplicates({
      client,
      uid: user.uid,
      title: title.trim(),
      categoryId: cat,
      newHashes: photos.map((p) => p.hash).filter(Boolean),
      excludeId: editId || undefined,
    });
    setProgress(null);
    if (dup) {
      fail(t(dup === 'photo' ? 'duplicatePhotoWarn' : 'duplicateTitleWarn'));
      return;
    }

    setSubmitting(true);

    try {
      const priceNum = price.trim() === '' ? 0 : Number(price);
      const effPrice = cat === 'jobs' ? 0 : priceNum;
      // wanted → 0 ("all wilayas"); job seekers (form isWanted=false) keep
      // their concrete wilaya.
      // R52-B2 (18 Oct 2026): a wanted EDIT keeps its stored wilaya — the
      // wilaya select is hidden in wanted mode, and jobSeeker ads may
      // carry a concrete wilaya (CF W-02: 0..69 allowed). Forcing 0 here
      // silently reset it to "all wilayas" on every edit save.
      const wilayaCode = isWanted
        ? (editId ? Number(wilaya || '0') : 0)
        : Number(wilaya || 16);
      const idToken = await authMod.getIdToken(user);

      if (editId) {
        // Edit: direct Firestore update (owner only, rules enforce).
        // Round 30 CS-1 (18 Oct 2026): negotiable is now INCLUDED in the
        // edit payload. The Batch-3 owner-edit rule explicitly lists
        // 'negotiable' in its affectedKeys() allowlist, so changing the
        // toggle in edit mode saves correctly instead of being dropped.
        const saleQty = isWanted ? 1 : Math.max(1, Number(qty) || 1);
        // Read current doc for version + price-drop detection
        const curSnap = await fsMod.getDoc(fsMod.doc(db, 'listings', editId));
        const cur = curSnap.exists() ? (curSnap.data() as Record<string, unknown>) : {};
        // AT-10 (R12, 18 Oct 2026): sold listings cannot be edited —
        // server handleEdit rejects them; the client bypassed it via
        // direct updateDoc. Block here with a clear message.
        if (cur.status === 'sold') {
          fail(t('editSoldError'));
          return;
        }
        const oldPrice = Number(cur.price || 0);
        // 11 Oct 2026: category change is not a price drop (was false alerts).
        const priceDropped = effPrice < oldPrice && cat === String(cur.categoryId || '');
        // Upload any newly picked photos (with variants + hashes)
        const up = await uploadNewPhotos(photos, user.uid, editId, idToken);
        // 12 Oct 2026 (v124 live): 'photoVariants' is now in the owner-edit
        // allowlist, so a stale flag CAN be cleared. If new photos were added
        // to a doc with photoVariants===true but their variant files are still
        // missing after retries, clear the flag in the same edit update below
        // instead of refusing the save — the listing then renders via the
        // non-variant image path instead of 404ing derived variant URLs.
        const clearStaleVariants =
          photos.length > 0 && cur.photoVariants === true && up.variantsOk.some((ok) => !ok);
        // Merge: existing kept photos first, then new uploads (legacy mergeEditPhotos)
        const mergedUrls = existingPhotos.map((p) => p.url).concat(up.urls);
        // AT-9: sanitize any empty/invalid hashes from old docs (same
        // rule as uploadNewPhotos — server rejects non-16-hex entries).
        const cleanHash = (h: string) =>
          /^[0-9a-fA-F]{16}$/.test(h || '')
            ? h
            : [...crypto.getRandomValues(new Uint8Array(8))]
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        const mergedHashes = existingPhotos
          .map((p) => cleanHash(p.hash || ''))
          .concat(up.hashes);
        const mergedThumbs = existingPhotos.map((p) => p.thumb).concat(up.thumbs);
        // Canonicalize answer keys for Firestore (same Q_TO_SHORT as publish flow).
        // Edit mode must send short keys (brand, year...) not q* form keys.
        // 11 Oct 2026: use FULL mapping (was 9 keys — 30+ keys denied by v122).
        const Q_TO_SHORT_EDIT: Record<string, string> = {
          qArea: 'area', qAvailability: 'availability', qBattery: 'battery',
          qBatteryRange: 'batteryRange', qBeautyType: 'type', qBeautyCond: 'condition',
          qBrand: 'brand', qCarBrand: 'brand', qPhoneBrand: 'brand',
          qTrotBrand: 'brand', qMachineBrand: 'brand',
          qCarModel: 'model', qModel: 'model',
          qCondition: 'condition', qContract: 'contract',
          qExperience: 'experience', qFuel: 'fuel', qGear: 'gear',
          qGender: 'gender', qJobTitle: 'jobTitle', qJobType: 'jobType',
          qListingPurpose: 'purpose', qPurpose: 'purpose',
          qMachineDomain: 'domain', qMachineYear: 'year',
          qMileage: 'mileage', qOs: 'os', qPricing: 'pricing',
          qProductType: 'type', qProfession: 'profession',
          qPropertyType: 'propertyType', qRooms: 'rooms', qSalary: 'salary',
          qSector: 'sector', qSpareFor: 'forVehicle',
          qSpareModel: 'compatibleModel', qStorage: 'storage',
          qTrotType: 'trotType', qVeloType: 'veloType', qVolume: 'volume',
          qWheelSize: 'wheelSize', qYear: 'year',
        };
        const NUMERIC_ANSWERS_EDIT = new Set(['year', 'mileage', 'rooms', 'area', 'salary', 'experience']);
        const canonAnswers: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(answers)) {
          const short = Q_TO_SHORT_EDIT[k] || k;
          // DK-2 (R36, 18 Oct 2026): same numeric coercion as the publish
          // path — year/mileage/rooms/area/salary/experience must be sent as
          // numbers, not strings, or they drift permanently vs publish.
          canonAnswers[short] =
            NUMERIC_ANSWERS_EDIT.has(short) && v !== '' && v != null ? Number(v) : (v as string);
        }
        const updateDoc: Record<string, unknown> = {
          // BE-2 (R16, 18 Oct 2026): preserve existing fr/en translations.
          // The form only edits the Arabic text; spreading the stored
          // object keeps fr/en (and any other keys) instead of deleting
          // them. Legacy string titles fall back to {} — ar-only write.
          title: {
            ...((cur.title && typeof cur.title === 'object')
              ? (cur.title as Record<string, string>) : {}),
            ar: title.trim(),
          },
          description: {
            ...((cur.description && typeof cur.description === 'object')
              ? (cur.description as Record<string, string>) : {}),
            ar: desc.trim(),
          },
          price: effPrice,
          // AT-11 (R12, 18 Oct 2026): categoryId removed from edit payload —
          // server handleEdit rejects category changes; the rules allowlist
          // should not have included it. Edits keep their original category.
          wilayaCode,
          condition: cat === 'beauty' ? answers['qBeautyCond'] || '' : condition,
          answers: canonAnswers,
          // Round 30 CS-1: same semantics as publish (line ~1337) — jobs and
          // wanted never carry negotiable; otherwise the edit toggle saves.
          negotiable: isWanted || cat === 'jobs' ? false : negotiable,
          quantity: saleQty,
          isWholesale: saleQty > 1,
          version: Number(cur.version || 0) + 1,
          priceReduced: priceDropped,
          previousPrice: priceDropped ? oldPrice : null,
          updatedAt: fsMod.serverTimestamp(),
          // AT-12 (R12, 18 Oct 2026): isWanted removed from edit payload —
          // rules pin it immutable; writing it on jobSeeker edits caused
          // denials with a generic error. The original value is preserved
          // by not writing the field.
        };
        // Only touch photos when the user changed them (picked new or removed existing)
        if (photos.length || existingDirty) {
          updateDoc.photoUrls = mergedUrls;
          updateDoc.photoCount = mergedUrls.length;
          updateDoc.photoHashes = mergedHashes.slice(0, mergedUrls.length);
          updateDoc.photo_thumbs = mergedThumbs.slice(0, mergedUrls.length);
          // 12 Oct 2026 (v124 live): clear a stale photoVariants flag when
          // variant uploads failed after retries — now allowed by the rules.
          // The listing falls back to the non-variant image path.
          if (clearStaleVariants) {
            updateDoc.photoVariants = false;
          }
        }
        try {
          await fsMod.updateDoc(fsMod.doc(db, 'listings', editId), updateDoc);
        } catch {
          // The update itself failed (rules/network) — refuse rather than
          // leave a half-applied edit.
          fail(t('editError'));
          return;
        }
        // Delete R2 objects for photos removed in edit mode (best-effort).
        // The server skips non-R2 values and enforces uid ownership.
        if (removedExisting.length) {
          try {
            await deleteR2Objects(removedExisting, idToken);
          } catch {
            // non-fatal — the doc update already succeeded
          }
        }
        // Price-drop notifications (js/publish.js 4 Oct 2026 parity):
        // Firestore triggers are unreliable in this project, so the web
        // client writes price_drop notifications directly to favoriters'
        // inboxes. Best-effort — the price edit above already succeeded.
        // Rules v110+ verify: writer is the listing's seller AND the
        // recipient has a favorite doc for the listing.
        if (priceDropped) {
          try {
            const favSnap = await fsMod.getDocs(
              fsMod.collection(db, 'listingFavoriters', editId, 'users')
            );
            // AC-5 (Round 7, 18 Oct 2026): notifId was drop_{editId}_{effPrice}
            // with non-merge set — if the price returned to a previously-read
            // value, the re-set reset read:false. Unique ID per drop event
            // (timestamp) preserves read state on older notifications.
            const notifId = `drop_${editId}_${effPrice}_${Date.now()}`;
            const sellerUid = user.uid;
            const notifData = {
              listingId: editId,
              oldPrice,
              newPrice: effPrice,
              // Legacy reads ld.title (the {ar:...} object) into
              // data.title, which renders as "[object Object]" in the
              // read-time template — pass the plain string instead
              // (root-cause fix).
              title: title.trim(),
              photo: mergedUrls[0] || null,
            };
            const targets = favSnap.docs
              .map((d) => d.id)
              .filter((favUid) => favUid && favUid !== sellerUid);
            // Chunk at the Firestore 500-op batch limit (legacy Round 14).
            for (let i = 0; i < targets.length; i += 500) {
              const batch = fsMod.writeBatch(db);
              for (const favUid of targets.slice(i, i + 500)) {
                batch.set(
                  fsMod.doc(db, 'users', favUid, 'notifications', notifId),
                  {
                    type: 'price_drop',
                    fromUid: sellerUid,
                    title: '',
                    body: '',
                    data: notifData,
                    read: false,
                    createdAt: fsMod.serverTimestamp(),
                  }
                );
              }
              await batch.commit();
            }
          } catch {
            // best-effort — notification failed, price change kept
          }
        }
        try { localStorage.removeItem(draftKey(user.uid)); } catch { /* ignore */ }
        router.push(`/listing/${editId}`);
        return;
      }

      // Upload photos to R2 (main + w320/w640/w1024/w32 variants)
      const listingId = fsMod.doc(fsMod.collection(db, 'listings')).id;
      const up = await uploadNewPhotos(photos, user.uid, listingId, idToken);
      const urls = up.urls;
      const thumbs: (string | null)[] = up.thumbs;

      // Default images when no photo picked (app parity)
      // 11 Oct 2026: use full dzdlala.com URLs (backend rejects relative paths).
      // AT-4 (R12, 18 Oct 2026): use BARE domain (no www.) — server
      // allowlist exact-matches https://dzdlala.com/... (index.js:150-154).
      if (!urls.length) {
        const jt = answers['qJobType'];
        if (cat === 'jobs' && jt === 'jobSeeker') {
          urls.push('https://dzdlala.com/img/default_ads/seeker-v5.png');
          thumbs.push(null);
        } else if (cat === 'jobs' && jt === 'jobOffer') {
          urls.push('https://dzdlala.com/img/default_ads/offer-v5.png');
          thumbs.push(null);
        } else if (isWanted) {
          urls.push('https://dzdlala.com/img/default_ads/wanted-v5.png');
          thumbs.push(null);
        }
      }

      // Build payload
      // 11 Oct 2026: fixed key — was answers['jobType'], form uses qJobType.
      const isSeeker = cat === 'jobs' && answers['qJobType'] === 'jobSeeker';
      const saleQty = isWanted ? 1 : Math.max(1, Number(qty) || 1);
      // Canonicalize answer keys to production short format (js/publish.js).
      // The form uses q* field IDs (qCarBrand, qYear...), but the
      // publishListing Cloud Function validates against the production
      // question registry which expects short keys (brand, year...).
      // Without this, EVERY publish fails with INVALID_ARGUMENT.
      const Q_TO_SHORT: Record<string, string> = {
        qArea: 'area', qAvailability: 'availability', qBattery: 'battery',
        qBatteryRange: 'batteryRange', qBeautyType: 'type', qBeautyCond: 'condition',
        qBrand: 'brand', qCarBrand: 'brand', qPhoneBrand: 'brand',
        qTrotBrand: 'brand', qMachineBrand: 'brand',
        qCarModel: 'model', qModel: 'model',
        qCondition: 'condition', qContract: 'contract',
        qExperience: 'experience', qFuel: 'fuel', qGear: 'gear',
        qGender: 'gender', qJobTitle: 'jobTitle', qJobType: 'jobType',
        qListingPurpose: 'purpose', qPurpose: 'purpose',
        qMachineDomain: 'domain', qMachineYear: 'year',
        qMileage: 'mileage', qOs: 'os', qPricing: 'pricing',
        qProductType: 'type', qProfession: 'profession',
        qPropertyType: 'propertyType', qRooms: 'rooms', qSalary: 'salary',
        qSector: 'sector', qSpareFor: 'forVehicle',
        qSpareModel: 'compatibleModel', qStorage: 'storage',
        qTrotType: 'trotType', qVeloType: 'veloType', qVolume: 'volume',
        qWheelSize: 'wheelSize', qYear: 'year',
      };
      const NUMERIC_ANSWERS = new Set(['year', 'mileage', 'rooms', 'area', 'salary', 'experience']);
      const canonAnswers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(answers)) {
        if (v === '' || v == null) continue;
        const short = Q_TO_SHORT[k] || k;
        // AT-2 (R12, 18 Oct 2026): do NOT skip qBeautyCond — server
        // validateBeauty requires answers.condition (new/good/used).
        // It is stored BOTH in answers and as top-level condition.
        canonAnswers[short] = NUMERIC_ANSWERS.has(short) ? Number(v) : v;
      }
      const payload = {
        id: listingId,
        categoryId: cat,
        title: { ar: title.trim() },
        description: { ar: desc.trim() },
        price: effPrice,
        wilayaCode,
        negotiable: isWanted || cat === 'jobs' ? false : negotiable,
        isWanted: isWanted || isSeeker,
        condition: cat === 'beauty' ? answers['qBeautyCond'] || '' : condition,
        answers: canonAnswers,
        photoUrls: urls,
        photoHashes: up.hashes.slice(0, urls.length),
        photo_thumbs: urls.map((_, i) => thumbs[i] || null),
        photoVariants: true,
        quantity: saleQty,
        isWholesale: saleQty > 1,
        sellerName: user.displayName || '',
        sellerPhotoUrl: '',
      };

      setProgress(t('progPublishing'));
      const fnRes = await fetch(PUBLISH_FN_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ data: payload, idToken }),
      });
      const fnBody = await fnRes.json().catch(() => null);
      if (!fnRes.ok || !fnBody || fnBody.error) {
        const code = String(
          (fnBody?.error?.status || 'http' + fnRes.status)
        ).toLowerCase().replace(/_/g, '-');
        if (code === 'resource-exhausted') { fail(t('publishLimitDaily')); return; }
        if (code === 'unauthenticated' || code === 'permission-denied') {
          fail(t('mustLogin')); return;
        }
        // Show the backend's specific error message for diagnosis (not just generic).
        const backendMsg = fnBody?.error?.message;
        if (backendMsg && typeof backendMsg === 'string') {
          fail(`${t('publishError')} [${backendMsg}]`);
        } else {
          fail(t('publishError'));
        }
        return;
      }
      const finalId = fnBody.result?.listingId || listingId;
      try {
        localStorage.setItem('dlala_last_publish', String(Date.now()));
        localStorage.removeItem(draftKey(user.uid));
      } catch { /* ignore */ }
      // ?return= support: pro vitrine picker's "+ منتج جديد" links here;
      // return with ?newListing=<id> inserted before any #fragment.
      const retParam = new URLSearchParams(window.location.search).get('return') || '';
      let dest = `/listing/${finalId}`;
      if (retParam && !retParam.startsWith('//') && /^\/[a-z0-9\-_./]*$/i.test(retParam) && !retParam.includes('..')) {
        const hi = retParam.indexOf('#');
        const base = hi >= 0 ? retParam.slice(0, hi) : retParam;
        const hash = hi >= 0 ? retParam.slice(hi) : '';
        dest = base + (base.includes('?') ? '&' : '?') + 'newListing=' + encodeURIComponent(finalId) + hash;
      }
      window.location.href = dest;
    } catch (err) {
      console.error('publish failed', err);
      fail(t('publishError'));
    } finally {
      setProgress(null);
      setSubmitting(false);
    }
  };

  const priceWords = dzPriceWords(Number(price) || 0);
  const showCondition = !isWanted && !['beauty', 'services', 'jobs'].includes(cat);
  const showPrice = cat !== 'jobs';
  const lblCls = 'block text-sm font-medium text-zinc-700 mb-1';

  return (
    <div className="min-h-screen bg-zinc-50">
      <main id="main-content" className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-zinc-900 mb-4">{t('publish')}</h1>

        {error && (
          <div
            className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate className="rounded-2xl bg-white shadow-sm p-5">
          {/* Mode toggle */}
          {!editId && (
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                // R52-B1 (18 Oct 2026): leaving wanted mode resets wilaya —
                // the wanted toggle set it to '0' ("all wilayas", no such
                // sale option), leaving the select blank and validate()
                // failing with a generic "fill required fields" error.
                onClick={() => { setIsWanted(false); setWilaya(''); }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  !isWanted ? 'bg-emerald-700 text-white' : 'bg-zinc-100 text-zinc-600'
                }`}
              >
                {t('modeSale')}
              </button>
              <button
                type="button"
                onClick={() => { setIsWanted(true); setWilaya('0'); }}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  isWanted ? 'bg-emerald-700 text-white' : 'bg-zinc-100 text-zinc-600'
                }`}
              >
                {t('modeWanted')}
              </button>
            </div>
          )}
          {isWanted && !editId && (
            <p className="mb-4 text-sm text-zinc-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t('wantedHintAuto')}
            </p>
          )}

          {/* Title */}
          <label htmlFor="pTitle" className={lblCls}>{t('title')}</label>
          <input
            id="pTitle"
            maxLength={80}
            className={inputCls}
            value={title}
            placeholder={t('titlePh')}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="text-xs text-zinc-400 mt-1 mb-4 text-left" dir="ltr">
            {title.length} / 80
          </div>

          {/* Category + Wilaya */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="pCat" className={lblCls}>{t('category')}</label>
              <select
                id="pCat"
                className={inputCls + (editId ? ' opacity-60' : '')}
                value={cat}
                // BE-3 (R16, 18 Oct 2026): category is immutable after
                // publish (AT-11: the edit payload excludes categoryId and
                // the server rejects changes). Disable the select in edit
                // mode with an explanatory note instead of letting the user
                // change it and silently not saving.
                disabled={!!editId}
                onChange={(e) => { setCat(e.target.value); setAnswers({}); }}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c[lang]}</option>
                ))}
              </select>
              {!!editId && (
                <p className="text-xs text-zinc-500 mt-1">{t('editCatLocked')}</p>
              )}
            </div>
            {!isWanted && (
              <div>
                <label htmlFor="pWilaya" className={lblCls}>{t('wilaya')}</label>
                <select
                  id="pWilaya"
                  className={inputCls}
                  value={wilaya}
                  onChange={(e) => setWilaya(e.target.value)}
                >
                  <option value="">—</option>
                  {WILAYAS.map((w) => (
                    <option key={w.code} value={String(w.code)}>
                      {w.code} - {lang === 'ar' ? w.ar : (lang === 'en' && w.en ? w.en : w.fr)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Category questions */}
          {cat && (
            <CatQuestions
              cat={cat}
              answers={answers}
              setAnswer={setAnswer}
            />
          )}

          {/* Price / condition / qty */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {showPrice && (
              <div>
                <label htmlFor="pPrice" className={lblCls}>
                  {isWanted ? t('budgetLabel') : t('price')}
                </label>
                <input
                  id="pPrice"
                  type="number"
                  min="1"
                  dir="ltr"
                  className={inputCls + ' text-left'}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                {priceWords && (
                  <div className="text-xs text-emerald-700 mt-1">{priceWords}</div>
                )}
              </div>
            )}
            {showCondition && (
              <div>
                <label htmlFor="pCond" className={lblCls}>{t('condition')}</label>
                <select
                  id="pCond"
                  className={inputCls}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="used">{t('condUsed')}</option>
                  <option value="new">{t('condNew')}</option>
                </select>
              </div>
            )}
            {!isWanted && (
              <div>
                <label htmlFor="pQty" className={lblCls}>{t('quantity')}</label>
                <input
                  id="pQty"
                  type="number"
                  min="1"
                  dir="ltr"
                  className={inputCls + ' text-left'}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            )}
          </div>

          {!isWanted && cat !== 'jobs' && (
            <label className="flex items-center gap-2 mb-4 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={negotiable}
                onChange={(e) => setNegotiable(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
              {t('negotiable')}
            </label>
          )}

          {/* Description */}
          <label htmlFor="pDesc" className={lblCls}>{t('description')}</label>
          <textarea
            id="pDesc"
            maxLength={2000}
            rows={5}
            className={inputCls}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <div className="text-xs text-zinc-400 mt-1 mb-4 text-left" dir="ltr">
            {desc.length} / 2000
          </div>

          {/* Photos */}
          <label className={lblCls}>{t('photos')}</label>
          <p className="text-xs text-zinc-500 mb-2">{t('photoMaxHint')}</p>
          {/* Fix 6: visible skipped-photo feedback (legacy #photoWarn) */}
          {photoWarn && (
            <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800" role="alert">
              {photoWarn}
            </div>
          )}
          {/* Fix 7: existing photos editor (edit mode) — legacy renderPhotoEditor */}
          {editId && existingPhotos.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-medium text-zinc-700 mb-2">{t('existingPhotos')}</h4>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {existingPhotos.map((p, i) => (
                  <div key={`ex-${i}`} className="relative rounded-lg overflow-hidden bg-zinc-100 aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb || p.url} alt="" className="w-full h-full object-cover" />
                    {i === 0 && (
                      <span className="absolute top-1 right-1 rounded bg-emerald-700 text-white text-xs px-1.5 py-0.5" title={t('coverPhoto')}>
                        ★
                      </span>
                    )}
                    <div className="absolute bottom-1 right-1 flex gap-1">
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() => moveExisting(i, -1)}
                          className="w-6 h-6 rounded-full bg-black/60 text-white text-xs"
                          aria-label={t('prevPhoto')}
                        >
                          ←
                        </button>
                      )}
                      {i < existingPhotos.length - 1 && (
                        <button
                          type="button"
                          onClick={() => moveExisting(i, 1)}
                          className="w-6 h-6 rounded-full bg-black/60 text-white text-xs"
                          aria-label={t('nextPhoto')}
                        >
                          →
                        </button>
                      )}
                      {i > 0 && (
                        <button
                          type="button"
                          onClick={() => setExistingCover(i)}
                          className="w-6 h-6 rounded-full bg-black/60 text-amber-300 text-xs"
                          title={t('setAsCover')}
                          aria-label={t('setAsCover')}
                        >
                          ★
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeExisting(i)}
                        className="w-6 h-6 rounded-full bg-red-600 text-white text-xs"
                        aria-label={t('deletePhoto')}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
            {photos.map((p, i) => (
              <div key={i} className="relative rounded-lg overflow-hidden bg-zinc-100 aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-1 right-1 flex gap-1">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => movePhoto(i, -1)}
                      className="w-6 h-6 rounded-full bg-black/60 text-white text-xs"
                      aria-label="←"
                    >
                      ←
                    </button>
                  )}
                  {i < photos.length - 1 && (
                    <button
                      type="button"
                      onClick={() => movePhoto(i, 1)}
                      className="w-6 h-6 rounded-full bg-black/60 text-white text-xs"
                      aria-label="→"
                    >
                      →
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="w-6 h-6 rounded-full bg-red-600 text-white text-xs"
                    aria-label={t('deletePhoto')}
                  >
                    ×
                  </button>
                </div>
                {i === 0 && (
                  <span className="absolute top-1 right-1 rounded bg-emerald-700 text-white text-xs px-1.5 py-0.5">
                    {t('coverPhoto')}
                  </span>
                )}
              </div>
            ))}
            {/* DE-4 (R34, 18 Oct 2026): count existing photos too in edit
                mode — the + button ignored them and offered slots already
                taken. */}
            {(photos.length + existingPhotos.length) < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border-2 border-dashed border-zinc-300 aspect-square flex items-center justify-center text-zinc-400 text-3xl hover:border-emerald-500"
                aria-label={t('photos')}
              >
                +
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { onPickPhotos(e.target.files); e.target.value = ''; }}
          />

          {progress && (
            <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800" aria-live="polite">
              {progress}
            </div>
          )}

          <button type="submit" className={btnCls} disabled={submitting}>
            {submitting
              ? t('progPublishing')
              : editId
                ? t('saveChanges')
                : isWanted
                  ? t('publishWantedBtn')
                  : t('publishBtn')}
          </button>
        </form>
      </main>
    </div>
  );
}

function PublishPageInner() {
  const { lang } = useLang();
  const t = useCallback((k: string) => pubT(k, lang), [lang]);
  const auth = useRequireAuth();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const initialMode = searchParams.get('mode');

  if (auth.status === 'loading') return <LoadingSpinner />;
  if (auth.status === 'signed-out') return <LoadingSpinner label={t('mustLogin')} />;
  return (
    <PublishForm
      user={auth.user}
      client={auth.client}
      editId={editId}
      initialMode={initialMode}
    />
  );
}

export default function PublishPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PublishPageInner />
    </Suspense>
  );
}
