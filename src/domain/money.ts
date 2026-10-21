import type { CurrencyCode } from './types';

/** All money in this app is integer minor units (paise/cents). No floats touch totals. */

export const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
};

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  SGD: 'S$',
};

/** Approximate reference rates used ONLY to sanity-check feasibility across currencies.
 *  These are static planning approximations, not live market rates. */
export const CURRENCY_TO_INR: Record<CurrencyCode, number> = {
  INR: 1,
  USD: 84,
  EUR: 91,
  GBP: 108,
  AED: 23,
  SGD: 62,
};

export function toInr(minor: number, currency: CurrencyCode): number {
  const major = minor / 100;
  return Math.round(major * CURRENCY_TO_INR[currency]) * 100;
}

export function roundMinor(value: number): number {
  return Math.round(value);
}

export function clampMinor(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function formatMoney(minor: number, currency: CurrencyCode): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const major = minor / 100;
  const formatted = major.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const symbol = CURRENCY_SYMBOL[currency] ?? '';
  if (currency === 'AED' || currency === 'SGD') return `${symbol}${formatted}`;
  return `${symbol}${formatted}`;
}

/** Parse user-entered major units ("1,50,000" / "150000.50") into minor units. */
export function parseMoneyInput(raw: string, currency: CurrencyCode): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const major = Number(parts[0] || '0');
  const frac = parts[1] ?? '';
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  if (!Number.isFinite(major) || major < 0) return null;
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const minorFrac = fracPadded ? Number(fracPadded) : 0;
  const total = Math.round(major) * 100 + minorFrac;
  if (!Number.isSafeInteger(total)) return null;
  return total;
}

export function majorToMinor(major: number, currency: CurrencyCode): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return Math.round(major * 10 ** decimals);
}

export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
