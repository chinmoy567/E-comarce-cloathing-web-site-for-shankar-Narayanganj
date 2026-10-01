import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/lib/sanitizeHtml.js';
import { createSectionSchema, createCampaignSchema } from '../../src/validation/homepageCms.validation.js';

describe('adversarial CMS input (13-homepage-cms §13.13)', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<p style="background:url(javascript:1)">x</p>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<form action="https://evil.example"><input></form>',
  ];
  for (const p of payloads) {
    it(`neutralises ${p}`, () => {
      const out = sanitizeHtml(p).toLowerCase();
      expect(out).not.toMatch(/<script|<img|<svg|<iframe|<form|onerror|onload|javascript:|data:|style=/);
    });
  }

  const baseSection = { sectionType: 'PROMO_BANNER', contentConfig: {} };
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://evil.example/x.png', 'https://evil.example/x.png', 'https://fabrillke.com/x.png', 'https://fabrillke.com.evil.example/x.png']) {
    it(`rejects section image URL ${bad}`, () => {
      expect(createSectionSchema.safeParse({ ...baseSection, desktopImageUrl: bad }).success).toBe(false);
      expect(createSectionSchema.safeParse({ ...baseSection, mobileImageUrl: bad }).success).toBe(false);
    });
  }

  it('accepts https images on the Supabase host', () => {
    for (const ok of [`${new URL(process.env.SUPABASE_URL!).origin}/storage/v1/object/public/homepage-images/a.png`]) {
      expect(createSectionSchema.safeParse({ ...baseSection, desktopImageUrl: ok }).success).toBe(true);
    }
  });

  it('rejects a section with an unknown sectionType and unknown extra fields', () => {
    expect(createSectionSchema.safeParse({ sectionType: 'EVIL', contentConfig: {} }).success).toBe(false);
    expect(createSectionSchema.safeParse({ ...baseSection, isAdmin: true }).success).toBe(false);
  });

  it('rejects campaign slug injection', () => {
    for (const slug of ['A B', "x'; drop table--", '../etc', 'UPPER']) {
      expect(createCampaignSchema.safeParse({ name: 'n', slug }).success).toBe(false);
    }
  });
});
