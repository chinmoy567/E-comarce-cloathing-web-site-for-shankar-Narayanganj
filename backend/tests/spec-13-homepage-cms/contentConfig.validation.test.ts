import { describe, expect, it } from 'vitest';
import { contentConfigSchemaFor } from '../../src/services/homepageCms/contentConfig.schemas.js';

/** Spec 13 — per-section_type content_config validation (§13.3). No DB. */
describe('contentConfigSchemaFor (13-homepage-cms §13.3)', () => {
  it('HERO accepts a valid overlayPosition and rejects an unknown key', () => {
    const schema = contentConfigSchemaFor('HERO');
    expect(schema.safeParse({ overlayPosition: 'left' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ overlayPosition: 'left', extra: 1 }).success).toBe(false);
  });

  it('CATEGORY_GRID requires mode and rejects an invalid columns value', () => {
    const schema = contentConfigSchemaFor('CATEGORY_GRID');
    expect(schema.safeParse({ mode: 'ALL_ACTIVE_TOP_LEVEL' }).success).toBe(true);
    expect(schema.safeParse({ mode: 'MANUAL', columns: 3 }).success).toBe(true);
    expect(schema.safeParse({ mode: 'MANUAL', columns: 5 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('PRODUCT_CAROUSEL AUTOMATIC requires categoryId when rule is CATEGORY', () => {
    const schema = contentConfigSchemaFor('PRODUCT_CAROUSEL');
    expect(schema.safeParse({ mode: 'AUTOMATIC', rule: 'LATEST', limit: 12 }).success).toBe(true);
    expect(schema.safeParse({ mode: 'AUTOMATIC', rule: 'CATEGORY', limit: 12 }).success).toBe(false);
    expect(
      schema.safeParse({ mode: 'AUTOMATIC', rule: 'CATEGORY', limit: 12, categoryId: '11111111-1111-1111-1111-111111111111' }).success,
    ).toBe(true);
    expect(schema.safeParse({ mode: 'MANUAL' }).success).toBe(true);
  });

  it('a shape valid for a different section_type is rejected', () => {
    const heroSchema = contentConfigSchemaFor('HERO');
    // A CATEGORY_GRID shape has an unknown key ("mode") from HERO's perspective.
    expect(heroSchema.safeParse({ mode: 'MANUAL' }).success).toBe(false);
  });

  it('CAMPAIGN_BANNER accepts only an empty object', () => {
    const schema = contentConfigSchemaFor('CAMPAIGN_BANNER');
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ anything: true }).success).toBe(false);
  });

  it('PROMO_BANNER accepts its optional link fields', () => {
    const schema = contentConfigSchemaFor('PROMO_BANNER');
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ linkType: 'COUPON', couponCode: 'SAVE20' }).success).toBe(true);
    expect(schema.safeParse({ linkType: 'INVALID' }).success).toBe(false);
  });

  it('CUSTOM_CONTENT requires a non-empty body', () => {
    const schema = contentConfigSchemaFor('CUSTOM_CONTENT');
    expect(schema.safeParse({ body: '<p>Hello</p>' }).success).toBe(true);
    expect(schema.safeParse({ body: '' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('unknown keys are rejected across every section type (.strict())', () => {
    for (const type of ['HERO', 'CATEGORY_GRID', 'CAMPAIGN_BANNER', 'PROMO_BANNER', 'CUSTOM_CONTENT'] as const) {
      const schema = contentConfigSchemaFor(type);
      const base = type === 'CUSTOM_CONTENT' ? { body: 'x' } : type === 'CATEGORY_GRID' ? { mode: 'ALL_ACTIVE_TOP_LEVEL' } : {};
      expect(schema.safeParse({ ...base, unknownField: 'x' }).success).toBe(false);
    }
  });
});
