/**
 * Slug generation (spec 05 §Slug generation, `seo` skill §2).
 *
 * Lower-cased, ASCII-transliterated (diacritics stripped), non-alphanumerics
 * collapsed to `-`, trimmed to 80 chars. Slugs are STABLE: renaming a product
 * does not change its slug by default (a slug change is an explicit opt-in
 * field on update, handled by the caller, not this module).
 *
 * Collision resolution (`-2`, `-3`, ...) is resolved by the caller inside the
 * insert transaction, retrying on the `UNIQUE(slug)` constraint conflict —
 * the constraint is the real guard against two concurrent creates taking the
 * same slug; this function only proposes candidates.
 */

const MAX_SLUG_LENGTH = 80;

/** Base slug candidate from a name — no collision suffix. */
export function generateSlug(name: string): string {
  const transliterated = name
    .normalize('NFKD')
    // Strip combining diacritical marks left behind by NFKD normalization.
    .replace(/[̀-ͯ]/g, '');

  const slug = transliterated
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug || 'item';
}

/** The Nth collision candidate: `my-product`, `my-product-2`, `my-product-3`, ... */
export function collisionCandidate(baseSlug: string, attempt: number): string {
  if (attempt <= 1) return baseSlug;
  const suffix = `-${attempt}`;
  const truncatedBase = baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length);
  return `${truncatedBase}${suffix}`;
}
