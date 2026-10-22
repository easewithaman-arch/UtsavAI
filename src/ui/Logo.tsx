import { useId } from 'react';

/**
 * UtsavAI brand assets.
 *
 * The mark is a "U" whose right arm lifts into a tapering ribbon, with a small
 * sparkle above it. The wordmark keeps "Utsav" in the surrounding text colour
 * and accents "AI" with the brand gradient (saffron -> orange -> coral ->
 * deep violet).
 *
 * Colours come from CSS custom properties (--logo-saffron ... --logo-violet) so
 * the same markup can sit on light or dark surfaces: `.logo--dark` swaps in
 * brighter stops and `.logo--auto` follows prefers-color-scheme.
 */

export type LogoTone = 'light' | 'dark' | 'auto';

export const MARK_VIEW_BOX = '0 0 64 64';
export const WORDMARK_VIEW_BOX = '0 0 150 52';

export const MARK_PATH =
  'M 16 18 L 16 37 C 16 48 22 58 33 58 C 44 58 50 48 50 37 C 50 25 53.5 17 60 12 C 49 20 45 28 42 37 C 42 44 38 50 33 50 C 28 50 24 44 24 37 L 24 18 Z';

export const SPARK_PATH =
  'M 8 4.5 C 8.5 8.2 9.8 9.5 13.5 10 C 9.8 10.5 8.5 11.8 8 15.5 C 7.5 11.8 6.2 10.5 2.5 10 C 6.2 9.5 7.5 8.2 8 4.5 Z';

export const WORDMARK_FONT =
  "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, 'Times New Roman', serif";

/** Brand ramp used by the mark and by the "AI" of the wordmark. */
export const BRAND_RAMP = [
  { offset: '0', variable: '--logo-saffron', fallback: '#f3a83c' },
  { offset: '0.3', variable: '--logo-orange', fallback: '#f2853f' },
  { offset: '0.62', variable: '--logo-coral', fallback: '#ec6552' },
  { offset: '1', variable: '--logo-violet', fallback: '#4e1b63' },
] as const;

interface LogoCommonProps {
  className?: string;
  tone?: LogoTone;
}

interface LogoMarkProps extends LogoCommonProps {
  size?: number;
  title?: string;
}

interface LogoWordmarkProps extends LogoCommonProps {
  height?: number;
  title?: string;
}

interface LogoProps extends LogoCommonProps {
  height?: number;
  title?: string;
}

function logoClass(tone: LogoTone, extra?: string): string {
  const toneClass = tone === 'dark' ? 'logo--dark' : tone === 'auto' ? 'logo--auto' : '';
  return ['logo', toneClass, extra].filter(Boolean).join(' ');
}

function useGradientId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function rampStops() {
  return BRAND_RAMP.map((stop) => (
    <stop key={stop.variable} offset={stop.offset} style={{ stopColor: `var(${stop.variable}, ${stop.fallback})` }} />
  ));
}

/**
 * The symbol on its own: a rounded "U" that rises into a ribbon, plus a
 * sparkle. Square viewBox, so it stays crisp from a 16px favicon upwards.
 */
export function LogoMark({ className, tone = 'light', size = 40, title }: LogoMarkProps) {
  const markGradient = useGradientId('utsav-mark-');
  const sparkGradient = useGradientId('utsav-spark-');

  return (
    <svg
      className={logoClass(tone, className)}
      viewBox={MARK_VIEW_BOX}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={markGradient} x1="30" y1="6" x2="38" y2="60" gradientUnits="userSpaceOnUse">
          {rampStops()}
        </linearGradient>
        <linearGradient id={sparkGradient} x1="8" y1="4" x2="8" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--logo-spark-light, #ffc24d)' }} />
          <stop offset="1" style={{ stopColor: 'var(--logo-spark-deep, #f0862b)' }} />
        </linearGradient>
      </defs>
      <path d={MARK_PATH} fill={`url(#${markGradient})`} />
      <path d={SPARK_PATH} fill={`url(#${sparkGradient})`} />
    </svg>
  );
}

/**
 * The wordmark on its own: "Utsav" inherits the current text colour, "AI"
 * carries the brand gradient.
 */
export function LogoWordmark({ className, tone = 'light', height = 32, title }: LogoWordmarkProps) {
  const aiGradient = useGradientId('utsav-ai-');
  const width = Math.round((height * 150 * 100) / 52) / 100;

  return (
    <svg
      className={logoClass(tone, className)}
      viewBox={WORDMARK_VIEW_BOX}
      height={height}
      width={width}
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={aiGradient} x1="106" y1="19" x2="142" y2="44" gradientUnits="userSpaceOnUse">
          {rampStops()}
        </linearGradient>
      </defs>
      <text
        x="2"
        y="44"
        textLength="100"
        lengthAdjust="spacing"
        fontFamily={WORDMARK_FONT}
        fontSize="36"
        fontWeight="700"
        fill="currentColor"
      >
        Utsav
      </text>
      <text
        x="106"
        y="44"
        textLength="36"
        lengthAdjust="spacing"
        fontFamily={WORDMARK_FONT}
        fontSize="36"
        fontWeight="700"
        fill={`url(#${aiGradient})`}
      >
        AI
      </text>
    </svg>
  );
}

/**
 * Mark and wordmark together, for places that have room for the full lockup.
 */
export function Logo({ className, tone = 'light', height = 36, title = 'UtsavAI' }: LogoProps) {
  return (
    <span className={logoClass(tone, `logo-lockup ${className ?? ''}`.trim())}>
      <LogoMark tone={tone} size={height} />
      <LogoWordmark tone={tone} height={Math.round(height * 0.84)} title={title} />
    </span>
  );
}
