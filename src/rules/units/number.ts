import type { Precision } from '../../types.js';

const VULGAR: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const VULGAR_CLASS = `[${Object.keys(VULGAR).join('')}]`;
const DIGITS = String.raw`\d{1,3}(?:,\d{3})+|\d+`;

/** Matches `3`, `3.5`, `1,200`, `1 1/2`, `1½`, `½`, `3/4`, and a leading minus. */
export const NUMBER_PATTERN = [
  String.raw`[-−]?(?:${DIGITS})\s+\d+/\d+`,
  String.raw`[-−]?(?:${DIGITS})\s*${VULGAR_CLASS}`,
  String.raw`[-−]?\d+/\d+`,
  VULGAR_CLASS,
  String.raw`[-−]?(?:${DIGITS})(?:\.\d+)?`,
].join('|');

export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(/−/g, '-').replace(/,/g, '');
  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^-/, '');

  const vulgar = body.match(new RegExp(`^(\\d*)\\s*(${VULGAR_CLASS})$`));
  if (vulgar) {
    const whole = vulgar[1] ? Number(vulgar[1]) : 0;
    return sign * (whole + VULGAR[vulgar[2]!]!);
  }

  const mixed = body.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return sign * (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));

  const fraction = body.match(/^(\d+)\/(\d+)$/);
  if (fraction) return sign * (Number(fraction[1]) / Number(fraction[2]));

  const value = Number(body);
  return Number.isFinite(value) ? sign * value : null;
}

/**
 * How precisely the source was written. `6` claims one figure, `6.5` claims two, and
 * `350` claims two because the trailing zero is padding rather than measurement.
 */
export function significantFigures(raw: string): number {
  const text = raw.replace(/[,\s−-]/g, '');
  if (new RegExp(VULGAR_CLASS).test(text) || text.includes('/')) return 2;

  const [whole = '', decimal] = text.split('.');
  if (decimal !== undefined) {
    return (whole.replace(/^0+/, '') + decimal).replace(/^0+/, '').length || 1;
  }
  return whole.replace(/^0+/, '').replace(/0+$/, '').length || 1;
}

function roundToSignificant(value: number, figures: number): number {
  if (value === 0) return 0;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (figures - magnitude);
  return Math.round(value * factor) / factor;
}

function group(text: string): string {
  const [whole = '', decimal] = text.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  if (digits.length < 5) return text;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal ? `.${decimal}` : '');
}

function trim(value: number, maxDecimals: number): string {
  return group(String(Number(value.toFixed(maxDecimals))));
}

export function formatNumber(
  value: number,
  precision: Precision,
  sourceFigures: number,
  maxDecimals: number,
): string {
  if (typeof precision === 'number') return group(value.toFixed(precision));
  if (precision === 'exact') return trim(value, maxDecimals);
  // `natural`: never claim less than two figures, and never more than the source did.
  return trim(roundToSignificant(value, Math.max(2, sourceFigures)), 4);
}

/**
 * Oven temperatures are written in fives, so `350F` should land on 175C rather than
 * 176.7C. The habit only applies to the oven range; `100F` is a fever, not a setting.
 */
export function formatTemperature(
  celsius: number,
  precision: Precision,
  source: number,
  maxDecimals: number,
): string {
  if (typeof precision === 'number') return celsius.toFixed(precision);
  if (precision === 'exact') return trim(celsius, maxDecimals);
  const isOvenSetting = Number.isInteger(source) && source >= 200 && source % 25 === 0;
  if (isOvenSetting) return String(Math.round(celsius / 5) * 5);
  return String(Math.round(celsius * 10) / 10);
}
