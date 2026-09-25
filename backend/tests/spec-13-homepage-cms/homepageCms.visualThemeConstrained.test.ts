import { describe, expect, it } from 'vitest';
import { visualThemeSchema } from '../../src/services/homepageCms/contentConfig.schemas.js';

/** Spec 13 — visual_theme is a constrained enum, never raw CSS (§13.13). No DB. */
describe('visualThemeSchema (13-homepage-cms §13.13)', () => {
  it('accepts an allowlisted accentColor and bannerTreatment', () => {
    expect(visualThemeSchema.safeParse({ accentColor: 'primary', bannerTreatment: 'FULL_BLEED' }).success).toBe(true);
    expect(visualThemeSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an arbitrary CSS/hex string for accentColor', () => {
    expect(visualThemeSchema.safeParse({ accentColor: '#FF0000' }).success).toBe(false);
    expect(visualThemeSchema.safeParse({ accentColor: 'red' }).success).toBe(false);
  });

  it('rejects an unrecognized bannerTreatment', () => {
    expect(visualThemeSchema.safeParse({ bannerTreatment: 'CUSTOM_CSS_BLOCK' }).success).toBe(false);
  });

  it('rejects an unknown key entirely (no free-form field)', () => {
    expect(visualThemeSchema.safeParse({ customCss: 'body { color: red }' }).success).toBe(false);
  });
});
