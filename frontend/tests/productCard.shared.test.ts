import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec 13 — the shared `<ProductCard/>` (13-homepage-cms §13.9, plan §8 item
 * 18). No jsdom/React Testing Library is installed in this project yet, so
 * this is a structural check rather than a render test: it asserts
 * `<ProductCarousel/>` imports the real shared module rather than defining
 * its own card markup — the actual guarantee §13.9 requires.
 */
function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf-8');
}

describe('ProductCard is shared, not reimplemented (13-homepage-cms §13.9)', () => {
  it('ProductCarousel imports ProductCard from the shared module', () => {
    const source = readSource('components/homepage/ProductCarousel.tsx');
    expect(source).toMatch(/import\s*\{\s*ProductCard\s*\}\s*from\s*['"]@\/components\/ProductCard['"]/);
  });

  it('ProductCarousel renders <ProductCard/>, not its own product markup', () => {
    const source = readSource('components/homepage/ProductCarousel.tsx');
    expect(source).toMatch(/<ProductCard\b/);
    // No hand-rolled price/discount markup duplicated in the carousel itself.
    expect(source).not.toMatch(/line-through/);
  });

  it('no category- or campaign-named homepage component exists (§13.9)', () => {
    const glob = readFileSync(fileURLToPath(new URL('../src/components/homepage/HomepageSection.tsx', import.meta.url)), 'utf-8');
    expect(glob).not.toMatch(/MenCategory|EidBanner|ElectronicsCategory/);
  });
});
