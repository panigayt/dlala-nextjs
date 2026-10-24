'use client';

// Numeric filter input with an inline "not a number" hint — Round 18 BK-obs2.
//
// Junk min/max values were silently ignored server-side (Number(junk) → NaN)
// with no user-facing indication the filter was dropped. This shows a small
// hint under the input in the user's language whenever the field holds a
// non-numeric value:
//
// - URL junk (e.g. ?min=<script>…): the caller passes invalid={true} (see
//   isJunkNumeric); type="number" sanitizes the rendered value to '', but the
//   hint tells the user the filter wasn't applied.
// - Typed junk: for type="number" the browser reports '' as the value for
//   non-numeric text, so the only trace of the attempt is
//   validity.badInput — evaluated on blur (evaluated on change would nag
//   mid-typing, e.g. the "-" of "-5").
//
// Works in both modes the filter bars use:
// - uncontrolled (the /search FilterBar GET form): name + defaultValue
// - controlled (the home HomeFilters/HomeFacetBar): value + onChange

import { useState } from 'react';
import { useLang } from '@/lib/i18n';

/** True when a raw filter string is present but not a finite number. */
export function isJunkNumeric(v: string | undefined | null): boolean {
  if (v === undefined || v === null) return false;
  const s = v.trim();
  if (s === '') return false;
  return !Number.isFinite(Number(s));
}

// R29-5 (24 Oct 2026): the shared digit-extraction helper for pasted
// values. Prices reach these fields by copy-paste more than by typing —
// copied from a listing («3,100,000 دج») or from the price guide
// («3 125 000 دج») — and a type="number" input silently discards the
// whole paste (its value collapses to ''), so the filter/offer went
// out EMPTY with no error. normalizeNumericInput keeps only digits,
// first mapping Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹)
// glyphs to Latin; spaces of every kind (incl. U+00A0 / U+202F),
// commas, the Arabic thousands separator and any other character are
// stripped. '' in → '' out; garbage-only → '' (empty, never 0).
export function normalizeNumericInput(raw: string): string {
  let out = '';
  for (const ch of String(raw || '')) {
    const ai = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    const ei = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
    if (ei >= 0) {
      out += String(ei);
      continue;
    }
    if (ch >= '0' && ch <= '9') out += ch;
  }
  return out;
}

// What a number input accepts natively as a clean value — a paste of
// this shape proceeds untouched (byte-identical to pre-R29-5 behavior,
// decimals and all). Anything else would collapse to '' in the field,
// so the paste is intercepted and replaced by its digits.
const CLEAN_NUMERIC_PASTE = /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/;

/**
 * Paste handler core for every numeric field (filters, saved-search
 * bounds, offer/proposal amounts, publish price). Returns null when
 * the browser should handle the paste natively; otherwise the paste
 * has been preventDefault-ed and the caller must apply the returned
 * digit string as the field's new value ('' for garbage-only text).
 */
export function numericPasteValue(
  e: React.ClipboardEvent<HTMLInputElement>
): string | null {
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (text === '' || CLEAN_NUMERIC_PASTE.test(text)) return null;
  e.preventDefault();
  return normalizeNumericInput(text);
}

interface NumericFilterInputProps {
  id: string;
  name?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  inputMode?: 'numeric' | 'decimal';
  className?: string;
  // Uncontrolled mode (GET form).
  defaultValue?: string;
  // Controlled mode.
  value?: string;
  onChange?: (v: string) => void;
  // Pre-marked invalid — e.g. junk arrived in the URL (search page).
  invalid?: boolean;
}

export default function NumericFilterInput({
  id,
  name,
  placeholder,
  min,
  max,
  inputMode = 'numeric',
  className,
  defaultValue,
  value,
  onChange,
  invalid = false,
}: NumericFilterInputProps) {
  const { t } = useLang();
  const [typedBad, setTypedBad] = useState(false);
  const showHint = typedBad || invalid;

  return (
    <span className="inline-flex flex-col">
      <input
        id={id}
        type="number"
        name={name}
        min={min}
        max={max}
        inputMode={inputMode}
        placeholder={placeholder}
        defaultValue={defaultValue}
        value={value}
        aria-invalid={showHint || undefined}
        onPaste={(e) => {
          // R29-5: a formatted paste («1 000 000», «1,000,000», Arabic-
          // Indic digits) would otherwise collapse the field to '' and
          // silently drop the filter. Replace it with its digits.
          const v = numericPasteValue(e);
          if (v === null) return; // clean numeric paste — native path
          if (v) setTypedBad(false);
          else setTypedBad(true); // garbage-only paste — hint, value ''
          if (onChange) onChange(v);
          else e.currentTarget.value = v; // uncontrolled: read at submit
        }}
        onChange={(e) => {
          const el = e.currentTarget;
          // A valid (or emptied) value clears the typed-junk flag.
          if (!el.validity.badInput) setTypedBad(false);
          onChange?.(el.value);
        }}
        onBlur={(e) => {
          setTypedBad(e.currentTarget.validity.badInput);
        }}
        className={className}
      />
      {showHint ? (
        <span className="mt-0.5 text-xs text-red-600">{t('filterNotNumeric')}</span>
      ) : null}
    </span>
  );
}
