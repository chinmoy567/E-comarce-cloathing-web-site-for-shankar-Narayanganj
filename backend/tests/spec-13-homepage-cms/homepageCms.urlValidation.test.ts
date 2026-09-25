import { describe, expect, it } from 'vitest';
import { createSectionSchema } from '../../src/validation/homepageCms.validation.js';

/** Spec 13 — cta_url / secondary_cta_url validation (§13.13). No DB. */
describe('ctaUrl validation (13-homepage-cms §13.13)', () => {
  const base = {
    sectionType: 'HERO' as const,
    contentConfig: {},
  };

  it('rejects javascript:, data:, and bare http:// URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com']) {
      const result = createSectionSchema.safeParse({ ...base, ctaUrl: url });
      expect(result.success).toBe(false);
    }
  });

  it('accepts a relative storefront path and an allowed https:// URL', () => {
    expect(createSectionSchema.safeParse({ ...base, ctaUrl: '/category/men' }).success).toBe(true);
    expect(createSectionSchema.safeParse({ ...base, ctaUrl: 'https://fabrillke.com/category/men' }).success).toBe(true);
  });

  it('rejects a protocol-relative URL', () => {
    expect(createSectionSchema.safeParse({ ...base, ctaUrl: '//evil.example.com' }).success).toBe(false);
  });

  it('applies the same rule to secondaryCtaUrl', () => {
    expect(createSectionSchema.safeParse({ ...base, secondaryCtaUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(createSectionSchema.safeParse({ ...base, secondaryCtaUrl: '/sale' }).success).toBe(true);
  });
});
