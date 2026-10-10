// Dlala publish page — client component.
//
// Mirrors js/publish.js (0.0.0.43) exactly:
//   - Mode toggle: sale / wanted (wanted forces wilaya 0, hides condition/
//     quantity/negotiable, budget label, default wanted image).
//   - Category-specific questions (12 categories with custom fields).
//   - Photo upload: max 10, client-side downscale (1600px), EXIF stripped
//     via canvas, W320 WebP thumbnail, uploads to R2 (NOT Firebase Storage).
//   - Validation: title ≤80, desc ≤2000, price ≤100M, 2-min cooldown.
//   - Publish via publishListing Cloud Function (CORS-simple POST).
//   - Edit mode (?edit=id): pre-fills, saves via direct Firestore update.
//   - Draft autosave to localStorage.
//   - Auth: must be signed in AND email verified (requireVerifiedAsync).

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useRequireAuth,
  PageHeader,
  LoadingSpinner,
  inputCls,
  btnCls,
  type FirebaseClient,
  type CompatUser,
} from '@/lib/firebase-client';
import { WILAYAS } from '@/lib/wilayas';
import { CATEGORIES, dzPriceWords } from '@/lib/categories';
import { pubT } from '@/lib/publish-strings';
import { uploadToR2, r2KeyFor, deleteR2Objects } from '@/lib/r2-upload';
import { encodePhoto } from '@/lib/stripExif';
import { checkDuplicates } from '@/lib/duplicates';

const t = (k: string) => pubT(k, 'ar');
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
  if (!blob) return null;
  return new File([blob], `${baseName}${suffix}.webp`, { type: 'image/webp' });
}

async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // aHash from the already-decoded bitmap (same decode pass — legacy perf opt)
  let hash = '';
  try { hash = ahashOfBitmap(bitmap); } catch { /* fail-open */ }
  if (bitmap.close) bitmap.close();

  const baseName = (file.name || 'photo').replace(/\.\w+$/, '').slice(0, 40);
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
  // Draft restore — read once via lazy initializer (client-only, no effect)
  const readDraft = () => {
    if (editId || typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('dlala_publish_draft') || 'null');
    } catch {
      return null;
    }
  };
  const [isWanted, setIsWanted] = useState(initialMode === 'wanted');
  const router = useRouter();
  const [title, setTitle] = useState(() => readDraft()?.title || '');
  const [cat, setCat] = useState(() => readDraft()?.cat || '');
  const [wilaya, setWilaya] = useState(() => readDraft()?.wilaya || '');
  const [price, setPrice] = useState(() => readDraft()?.price || '');
  const [condition, setCondition] = useState('');
  const [qty, setQty] = useState('1');
  const [negotiable, setNegotiable] = useState(false);
  const [desc, setDesc] = useState(() => readDraft()?.desc || '');
  const [answers, setAnswers] = useState<Record<string, string>>(() => readDraft()?.answers || {});
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
    setAnswers((a) => ({ ...a, [k]: v }));
  }, []);

  // Draft autosave
  useEffect(() => {
    if (editId) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          'dlala_publish_draft',
          JSON.stringify({ title, cat, wilaya, price, desc, answers })
        );
      } catch { /* ignore */ }
    }, 1000);
    return () => clearTimeout(timer);
  }, [title, cat, wilaya, price, desc, answers, editId]);

  // Edit mode: load existing listing
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const snap = await client.db.collection('listings').doc(editId).get();
        if (!snap.exists) {
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
        setDesc((d.description as Record<string, string>)?.[lang] || '');
        setCat((d.categoryId as string) || '');
        setWilaya(String(d.wilayaCode ?? ''));
        setPrice(String(d.price ?? ''));
        setCondition((d.condition as string) || '');
        setQty(String(d.quantity ?? 1));
        setNegotiable(!!d.negotiable);
        setIsWanted(!!d.isWanted);
        if (d.answers && typeof d.answers === 'object') {
          setAnswers(d.answers as Record<string, string>);
        }
        // Fix 7: load existing photos with hashes + thumbs (legacy editListing.photoUrls)
        const pUrls = Array.isArray(d.photoUrls) ? d.photoUrls : [];
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
  }, [editId, client, user.uid]);

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
      const dropped = done.length - keepIdx.length;
      final = keepIdx.map((ki) => done[ki]);
      if (dropped > 0) console.log(`[pub] dropped ${dropped} duplicate photo(s) within ad`);
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
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(t('removePhotoConfirm'))) return;
    }
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
    if (!desc.trim()) { fail(t('errorDescRequired')); return false; }
    if (desc.trim().length > 2000) { fail(t('errorDescTooLong')); return false; }
    if (!cat) { fail(t('errorCatRequired')); return false; }
    const isJobsCat = cat === 'jobs';
    const priceNum = price.trim() === '' ? NaN : Number(price);
    if (!isJobsCat && !(priceNum >= 0)) { fail(t('errorPrice')); return false; }
    if (!isJobsCat && priceNum > 100000000) { fail(t('errorPriceTooHigh')); return false; }
    if (isWanted && wilaya !== '0') { fail(t('wantedWilayaAutoError')); return false; }
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
    if (cat === 'cars' && answers['qFuel'] !== 'fuelElectric' && !answers['qGear']) {
      fail(t('errorRequired')); return false;
    }
    // Year range validation (1990–currentYear+1)
    const curYear = new Date().getFullYear() + 1;
    if (cat === 'cars' && answers['qYear']) {
      const y = Number(answers['qYear']);
      if (!(y >= 1990 && y <= curYear)) {
        fail(t('errYearRange').replace('{min}', '1990').replace('{max}', String(curYear)));
        return false;
      }
    }
    if (cat === 'machines' && answers['qMachineYear']) {
      const y = Number(answers['qMachineYear']);
      if (!(y >= 1990 && y <= curYear)) {
        fail(t('errYearRange').replace('{min}', '1990').replace('{max}', String(curYear)));
        return false;
      }
    }
    // Condition required (except beauty/services/jobs/land/wanted)
    const isLand = cat === 'realestate' && answers['qPropertyType'] === 'reLand';
    if (!isWanted && !['beauty', 'services', 'jobs'].includes(cat) && !isLand) {
      if (!condition) { fail(t('selectCondition')); return false; }
    }
    return true;
  };

  // Upload new photos to R2: main + w320/w640/w1024/w32 variants (best-effort).
  // Returns { urls, hashes, thumbs } aligned 1:1 (legacy uploadPhotos parity).
  const uploadNewPhotos = async (
    list: ProcessedPhoto[],
    uid: string,
    listingId: string,
    idToken: string
  ): Promise<{ urls: string[]; hashes: string[]; thumbs: (string | null)[] }> => {
    const urls: string[] = [];
    const hashes: string[] = [];
    const thumbs: (string | null)[] = [];
    if (!list.length) return { urls, hashes, thumbs };
    setProgress(t('progUploading').replace('{x}', '0').replace('{y}', String(list.length)));
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const ts = Date.now();
      const key = r2KeyFor(uid, listingId, `${ts}_${i}.webp`);
      const { publicUrl } = await uploadToR2(p.file, key, idToken);
      urls.push(publicUrl);
      hashes.push(p.hash || '');
      // Variants: w320 thumb (photo_thumbs content), w640/w1024 heroes, w32 LQIP.
      // Best-effort — failures are swallowed, never fail publish.
      const uploadVariant = async (vf: File | null, vprefix: string): Promise<void> => {
        if (!vf) return;
        try {
          await uploadToR2(vf, r2KeyFor(uid, listingId, `${vprefix}_${ts}_${i}.webp`), idToken);
        } catch { /* variant failed — progressive enhancement */ }
      };
      if (p.thumb) {
        try {
          const tr = await uploadToR2(p.thumb, r2KeyFor(uid, listingId, `w320_${ts}_${i}.webp`), idToken);
          thumbs.push(tr.publicUrl);
        } catch {
          thumbs.push(null);
        }
      } else {
        thumbs.push(null);
      }
      await uploadVariant(p.w640, 'w640');
      await uploadVariant(p.w1024, 'w1024');
      await uploadVariant(p.lqip, 'w32');
      setProgress(
        t('progUploading')
          .replace('{x}', String(i + 1))
          .replace('{y}', String(list.length))
      );
    }
    return { urls, hashes, thumbs };
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    // Verified email required
    try { await user.getIdToken(true); } catch { /* ignore */ }
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
    const dupT0 = Date.now();
    const dup = await checkDuplicates({
      db: client.db,
      uid: user.uid,
      title: title.trim(),
      categoryId: cat,
      newHashes: photos.map((p) => p.hash).filter(Boolean),
      excludeId: editId || undefined,
    });
    console.log(`[pub] duplicate check: ${Date.now() - dupT0}ms`);
    setProgress(null);
    if (dup) {
      fail(t(dup === 'photo' ? 'duplicatePhotoWarn' : 'duplicateTitleWarn'));
      return;
    }

    setSubmitting(true);

    try {
      const priceNum = price.trim() === '' ? 0 : Number(price);
      const effPrice = cat === 'jobs' ? 0 : priceNum;
      // Job seekers keep their concrete wilaya despite isWanted=true
      const isSeekerPre = cat === 'jobs' && answers['qJobType'] === 'jobSeeker';
      const wilayaCode = isWanted && !isSeekerPre ? 0 : Number(wilaya || 16);
      const idToken = await user.getIdToken();

      if (editId) {
        // Edit: direct Firestore update (owner only, rules enforce).
        // Spec: negotiable is ABSENT from edit payload (edits never change it).
        const isSeeker = cat === 'jobs' && answers['qJobType'] === 'jobSeeker';
        const saleQty = isWanted ? 1 : Math.max(1, Number(qty) || 1);
        // Read current doc for version + price-drop detection
        const curSnap = await client.db.collection('listings').doc(editId).get();
        const cur = curSnap.exists ? (curSnap.data() as Record<string, unknown>) : {};
        const oldPrice = Number(cur.price || 0);
        const priceDropped = effPrice < oldPrice;
        // Upload any newly picked photos (with variants + hashes)
        const up = await uploadNewPhotos(photos, user.uid, editId, idToken);
        // Merge: existing kept photos first, then new uploads (legacy mergeEditPhotos)
        const mergedUrls = existingPhotos.map((p) => p.url).concat(up.urls);
        const mergedHashes = existingPhotos.map((p) => p.hash || '').concat(up.hashes);
        const mergedThumbs = existingPhotos.map((p) => p.thumb).concat(up.thumbs);
        const updateDoc: Record<string, unknown> = {
          title: { ar: title.trim() },
          description: { ar: desc.trim() },
          price: effPrice,
          categoryId: cat,
          wilayaCode,
          condition: cat === 'beauty' ? answers['qBeautyCond'] || '' : condition,
          answers,
          quantity: saleQty,
          isWholesale: saleQty > 1,
          version: Number(cur.version || 0) + 1,
          priceReduced: priceDropped,
          previousPrice: priceDropped ? oldPrice : null,
          updatedAt: client.FieldValue.serverTimestamp(),
          ...(isSeeker ? { isWanted: true } : {}),
        };
        // Only touch photos when the user changed them (picked new or removed existing)
        if (photos.length || existingDirty) {
          updateDoc.photoUrls = mergedUrls;
          updateDoc.photoHashes = mergedHashes.slice(0, mergedUrls.length);
          updateDoc.photo_thumbs = mergedThumbs.slice(0, mergedUrls.length);
          updateDoc.photoVariants = true;
        }
        await client.db.collection('listings').doc(editId).update(updateDoc);
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
            const favSnap = await client.db
              .collection(`listingFavoriters/${editId}/users`)
              .get();
            const notifId = `drop_${editId}_${effPrice}`;
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
              const batch = client.db.batch();
              for (const favUid of targets.slice(i, i + 500)) {
                batch.set(
                  client.db
                    .collection(`users/${favUid}/notifications`)
                    .doc(notifId),
                  {
                    type: 'price_drop',
                    fromUid: sellerUid,
                    title: '',
                    body: '',
                    data: notifData,
                    read: false,
                    createdAt: client.FieldValue.serverTimestamp(),
                  }
                );
              }
              await batch.commit();
            }
          } catch {
            // best-effort — notification failed, price change kept
          }
        }
        try { localStorage.removeItem('dlala_publish_draft'); } catch { /* ignore */ }
        router.push(`/listing/${editId}`);
        return;
      }

      // Upload photos to R2 (main + w320/w640/w1024/w32 variants)
      const listingId = client.db.collection('listings').doc().id;
      const up = await uploadNewPhotos(photos, user.uid, listingId, idToken);
      const urls = up.urls;
      const thumbs: (string | null)[] = up.thumbs;

      // Default images when no photo picked (app parity)
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
      const isSeeker = cat === 'jobs' && answers['jobType'] === 'jobSeeker';
      const saleQty = isWanted ? 1 : Math.max(1, Number(qty) || 1);
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
        answers,
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
        fail(t('publishError'));
        return;
      }
      const finalId = fnBody.result?.listingId || listingId;
      try {
        localStorage.setItem('dlala_last_publish', String(Date.now()));
        localStorage.removeItem('dlala_publish_draft');
      } catch { /* ignore */ }
      // ?return= support: pro vitrine picker's "+ منتج جديد" links here;
      // return with ?newListing=<id> inserted before any #fragment.
      const retParam = new URLSearchParams(window.location.search).get('return') || '';
      let dest = `/listing/${finalId}`;
      if (retParam && /^\/[a-z0-9\-_./]*$/i.test(retParam) && !retParam.includes('..')) {
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
    <div className="min-h-screen bg-zinc-50" dir="rtl">
      <PageHeader title="دلالة" />
      <main className="max-w-2xl mx-auto px-4 py-6">
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
                onClick={() => setIsWanted(false)}
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
                className={inputCls}
                value={cat}
                onChange={(e) => { setCat(e.target.value); setAnswers({}); }}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.ar}</option>
                ))}
              </select>
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
                      {w.code} - {w.ar}
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
                  min="0"
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
                      <span className="absolute top-1 right-1 rounded bg-emerald-700 text-white text-[10px] px-1.5 py-0.5" title={t('coverPhoto')}>
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
                  <span className="absolute top-1 right-1 rounded bg-emerald-700 text-white text-[10px] px-1.5 py-0.5">
                    {t('coverPhoto')}
                  </span>
                )}
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
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
