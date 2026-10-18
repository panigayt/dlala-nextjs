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
