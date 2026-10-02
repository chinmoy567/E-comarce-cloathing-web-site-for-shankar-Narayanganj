import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec 17 — structural guards for the CMS-driven homepage (13-homepage-cms
 * §13.7a, §13.9, §13.13; 17 "What the frontend must NOT do"). No jsdom is
 * installed, so these assert source-level properties, like productCard.shared.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (relativePath: string) => readFileSync(`${SRC}${relativePath}`, 'utf-8');
const homepageFiles = readdirSync(`${SRC}components/homepage`).filter((f) => f.endsWith('.tsx'));

describe('homepage components (17 / 13-homepage-cms §13.9)', () => {
  it('has exactly one component per section type and none named after a category or campaign', () => {
    const names = homepageFiles.map((f) => f.replace('.tsx', '')).sort();
    expect(names).toEqual(
      ['CampaignBanner', 'CategoryGrid', 'CtaLink', 'CustomContentBlock', 'HeroSection', 'HomepageSection', 'ProductCarousel', 'PromoBanner'].sort(),
    );
  });

  it('never decides visibility from the browser clock (§13.7a)', () => {
    for (const file of homepageFiles) {
      const source = read(`components/homepage/${file}`);
      expect(source, file).not.toMatch(/Date\.now\(|new Date\(/);
    }
  });

  it('every next/image fill carries a sizes attribute', () => {
    for (const file of homepageFiles) {
      const source = read(`components/homepage/${file}`);
      for (const tag of source.match(/<Image[\s\S]*?\/>/g) ?? []) {
        if (/\bfill\b/.test(tag)) expect(tag, file).toMatch(/\bsizes=/);
      }
    }
  });

  it('only HeroSection can render the page <h1>, and only when told to', () => {
    const hero = read('components/homepage/HeroSection.tsx');
    expect(hero).toMatch(/asH1 \? 'h1' : 'h2'/);
    for (const file of homepageFiles.filter((f) => f !== 'HeroSection.tsx')) {
      expect(read(`components/homepage/${file}`), file).not.toMatch(/<h1\b/);
    }
  });
});

describe('CTA link safety (§13.13, defence in depth)', () => {
  const source = read('components/homepage/CtaLink.tsx');

  it('accepts only relative paths and https:// URLs', () => {
    expect(source).toMatch(/startsWith\('\/'\)/);
    expect(source).toMatch(/startsWith\('https:\/\/'\)/);
    expect(source).not.toMatch(/javascript:|data:|http:\/\//);
  });

  it('rejects protocol-relative URLs', () => {
    expect(source).toMatch(/!href\.startsWith\('\/\/'\)/);
  });

  it('every CTA in the section components goes through CtaLink', () => {
    for (const file of ['HeroSection', 'CampaignBanner', 'PromoBanner']) {
      expect(read(`components/homepage/${file}.tsx`), file).toMatch(/<CtaLink\b/);
    }
  });
});

describe('homepage page (§13.15)', () => {
  const page = read('app/page.tsx');

  it('uses ISR and does not re-wrap an absolute og:image URL', () => {
    expect(page).toMatch(/export const revalidate = 60/);
    expect(page).not.toMatch(/absoluteUrl\(metadata\?\.ogImageUrl/);
  });

  it('guarantees exactly one h1', () => {
    expect(page).toMatch(/sr-only/);
    expect(page).toMatch(/asH1=\{section\.id === h1SectionId\}/);
  });

  it('fires no analytics events from the homepage (§13.16)', () => {
    expect(page).not.toMatch(/TrackEvent|trackEvent/);
  });
});

describe('admin builder (§13.12)', () => {
  const builder = read('app/admin/(shell)/content/homepage/page.tsx');

  it('reorders with one request carrying the whole id list', () => {
    expect(builder.match(/sections\/reorder/g)).toHaveLength(1);
    expect(builder).toMatch(/sectionIds: reordered\.map/);
  });

  it('restores the previous order when the reorder fails', () => {
    expect(builder).toMatch(/items: previous/);
  });

  it('labels a draft section Publish, not Disable', () => {
    expect(read('components/admin/homepage/SectionRow.tsx')).toMatch(/status === 'DRAFT' \? 'Publish'/);
  });

  it('never offers sectionType as editable on update', () => {
    expect(read('app/admin/(shell)/content/homepage/[id]/page.tsx')).not.toMatch(/sectionType:/);
  });

  it('no free-text UUID inputs remain in the section form', () => {
    const form = read('components/admin/HomepageSectionForm.tsx');
    expect(form).not.toMatch(/Campaign ID|Category ID/);
  });

  it('the category listing route that CategoryGrid links to exists', () => {
    expect(existsSync(`${SRC}app/category/[slug]/page.tsx`)).toBe(true);
  });
});
