import { describe, it, expect } from 'vitest';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { Logo, LogoMark, LogoWordmark, MARK_PATH, SPARK_PATH } from '../src/ui/Logo';

const render = (element: ReactElement) => renderToStaticMarkup(element);
const faviconSource = () => readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');

describe('the UtsavAI logo', () => {
  it('draws the mark on a square viewBox with no external assets', () => {
    const html = render(createElement(LogoMark, { size: 40 }));

    expect(html).toContain('viewBox="0 0 64 64"');
    expect(html).toContain('width="40"');
    expect(html).toContain('height="40"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain(MARK_PATH);
    expect(html).toContain(SPARK_PATH);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toContain('<image');
  });

  it('keeps the wordmark in step with its viewBox', () => {
    const html = render(createElement(LogoWordmark, { height: 30 }));

    expect(html).toContain('viewBox="0 0 150 52"');
    expect(html).toContain('height="30"');
    expect(html).toContain('width="86.54"');
    expect(html).toContain('>Utsav<');
    expect(html).toContain('>AI<');
    expect(html).toContain('fill="currentColor"');
  });

  it('combines the mark and the wordmark in one lockup', () => {
    const html = render(createElement(Logo, { height: 40 }));

    expect(html).toContain('logo-lockup');
    expect(html).toContain('viewBox="0 0 64 64"');
    expect(html).toContain('viewBox="0 0 150 52"');
    expect(html).toContain('>Utsav<');
  });

  it('gives every logo in a page its own gradient ids', () => {
    const html = renderToStaticMarkup(
      createElement(Fragment, null, createElement(Logo, {}), createElement(Logo, {})),
    );

    const ids = [...html.matchAll(/id="(utsav-[^"]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships a favicon that matches the component', () => {
    const favicon = faviconSource();

    expect(favicon).toContain('viewBox="0 0 64 64"');
    expect(favicon).toContain(MARK_PATH);
    expect(favicon).toContain(SPARK_PATH);
    expect(favicon).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(favicon).not.toContain('<image');
  });
});
