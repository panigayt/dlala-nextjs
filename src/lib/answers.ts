// Answers box label resolution — mirrors js/app.js renderAnswers +
// answerLabel (production 0.0.0.43).
//
// The stored `answers` map uses TWO key formats:
//   - legacy short keys (os, brand, year, fuel…) — written by the
//     production SPA (js/publish.js)
//   - q* keys (qOs, qPhoneBrand, qCarBrand…) — written by this Next.js
//     port's publish page
// Both are resolved to Arabic labels here so the answers box renders
// for listings from either writer.

import { PUB_STR } from './publish-strings';

// Legacy short key -> q* label key.
// From js/app.js ANSWER_KEY_LABELS (verbatim concept); adapted where the
// legacy pointed at facet*/keys absent from PUB_STR — the q* equivalents
// carry the identical Arabic label (e.g. qOs = "نظام التشغيل").
const SHORT_KEY_TO_Q: Record<string, string> = {
  type: 'qProductType',
  brand: 'qBrand',
  condition: 'qCondition',
  volume: 'qVolume',
  gender: 'qGender',
  os: 'qOs',
  model: 'qModel',
  storage: 'qStorage',
  battery: 'qBattery',
  year: 'qYear',
  mileage: 'qMileage',
  fuel: 'qFuel',
  gear: 'qGear',
  veloType: 'qVeloType',
  batteryRange: 'qBatteryRange',
  wheelSize: 'qWheelSize',
  trotType: 'qTrotType',
  domain: 'qMachineDomain',
  forVehicle: 'qSpareFor',
  compatibleModel: 'qSpareModel',
  jobType: 'qJobType',
  jobTitle: 'qJobTitle',
  contract: 'qContract',
  sector: 'qSector',
  salary: 'qSalary',
  profession: 'qProfession',
  experience: 'qExperience',
  availability: 'qAvailability',
  purpose: 'qListingPurpose',
  propertyType: 'qPropertyType',
  rooms: 'qRooms',
  area: 'qArea',
  pricing: 'qPricing',
  measurements: 'qVolume',
};

// Next.js publish-page q* keys with no PUB_STR entry -> label fallback.
const Q_FALLBACK: Record<string, string> = {
  qPhoneBrand: 'qBrand',
  qCarBrand: 'qBrand',
  qTrotBrand: 'qBrand',
  qMachineBrand: 'qBrand',
  qBeautyCond: 'qCondition',
  qCarModel: 'qModel',
};

function labelFor(key: string): string {
  let q = key;
  if (Q_FALLBACK[key]) {
    q = Q_FALLBACK[key];
  } else if (!PUB_STR[key]) {
    q = SHORT_KEY_TO_Q[key] || key;
  }
  return PUB_STR[q]?.ar || key;
}

function valueFor(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Option values (osAndroid, fuelPetrol…) resolve to their Arabic label;
  // free text (brand names, numbers) renders as-is. Mirrors answerLabel().
  return PUB_STR[s]?.ar || s;
}

export interface AnswerRow {
  label: string;
  value: string;
}

// Mirrors js/app.js renderAnswers(): one labeled row per answer entry.
// The salary "to be defined at the interview" toggle is a boolean —
// rendered as a labeled row only when true, never "true"/raw.
export function answerRows(
  answers: Record<string, unknown> | undefined | null
): AnswerRow[] {
  if (!answers || typeof answers !== 'object') return [];
  const rows: AnswerRow[] = [];
  for (const [k, v] of Object.entries(answers)) {
    if (k === 'salaryTbd') {
      if (v === true) {
        rows.push({ label: labelFor('qSalary'), value: labelFor('salaryTbd') });
      }
      continue;
    }
    rows.push({ label: labelFor(k), value: valueFor(v) });
  }
  return rows;
}
