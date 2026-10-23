import type { CurrencyCode } from '../domain/types';
import { formatMoney } from '../domain/money';

export { formatDate, formatDateTime } from '../domain/labels';

export function money(minor: number, currency: CurrencyCode): string {
  return formatMoney(minor, currency);
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
