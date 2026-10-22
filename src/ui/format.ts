import type { CurrencyCode } from '../domain/types';
import { formatMoney } from '../domain/money';

export { formatDate, formatDateTime } from '../domain/labels';

export function money(minor: number, currency: CurrencyCode): string {
  return formatMoney(minor, currency);
}

export function shortMoney(minor: number, currency: CurrencyCode): string {
  const value = minor / 100;
  if (currency === 'INR') {
    if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
    if (value >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`;
    if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}k`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return formatMoney(minor, currency);
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
