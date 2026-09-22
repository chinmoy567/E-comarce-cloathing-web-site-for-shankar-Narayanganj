/**
 * Website identity — the single source of truth for the brand name and
 * canonical domain.
 *
 * Every place that needs the site name or an absolute URL (page titles, SEO
 * metadata, Open Graph, Twitter cards, canonical links, `app/sitemap.ts`,
 * `app/robots.ts`, JSON-LD, the footer, WhatsApp share links) reads from here
 * rather than hard-coding a string, so the brand and domain can never drift
 * between surfaces (`seo` skill §3–§6; spec 07 §SEO).
 */

/** Official brand / website name. Never a placeholder like "Fashion Store". */
export const SITE_NAME = 'Fabrillke';

/** Bare domain, without scheme — for display and host allowlisting. */
export const SITE_DOMAIN = 'fabrillke.com';

/**
 * Canonical origin, with no trailing slash.
 *
 * Overridable via `NEXT_PUBLIC_SITE_URL` so preview/staging deployments
 * canonicalize to themselves instead of to production, per the `seo` skill §3
 * ("never hardcode a different domain than the one actually served").
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${SITE_DOMAIN}`).replace(
  /\/+$/,
  '',
);

/** Default storefront description, used where no entity-specific one exists. */
export const SITE_DESCRIPTION =
  'Shop the latest fashion and clothing at Fabrillke — delivered across Bangladesh with cash on delivery and bKash payment.';

/** Default social/sharing image path, resolved against SITE_URL. */
export const SITE_OG_IMAGE_PATH = '/og-default.jpg';

/**
 * Builds an absolute URL on the canonical origin.
 *
 * This is the one canonical-URL builder: SEO metadata, the sitemap, JSON-LD and
 * the WhatsApp product link all call it, so a product has exactly one published
 * identity (`seo` skill §4).
 */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Page title in the shared `<Page> | Fabrillke` form. The homepage passes no
 * argument and gets the bare brand name.
 */
export function pageTitle(title?: string): string {
  return title ? `${title} | ${SITE_NAME}` : SITE_NAME;
}
