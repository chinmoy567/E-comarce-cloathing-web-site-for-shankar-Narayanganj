import sanitizeHtmlLib from 'sanitize-html';

/**
 * Strict-allowlist server-side rich-text sanitizer (spec 04 §11.6, used by
 * specs 05, 13, 17). Runs before storage, not only at render — the frontend
 * also escapes on output, so neither layer assumes the other one sanitized
 * (§11.6, "treat input as untrusted" applies to both layers independently).
 *
 * `script` and `style` tags, every event-handler attribute (`onclick`, ...),
 * and `javascript:`-scheme URLs are always stripped, regardless of the
 * allowlist below.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'blockquote', 'a',
];

const ALLOWED_ATTRIBUTES: sanitizeHtmlLib.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
};

export function sanitizeHtml(input: string): string {
  return sanitizeHtmlLib(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    // Strips every `on*` handler by construction — only the attributes named
    // above pass through, and none of them is an event handler.
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
}
