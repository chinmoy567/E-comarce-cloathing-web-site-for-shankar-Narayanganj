import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../../src/lib/sanitizeHtml.ts';
/**
 * Spec 04 §11.6 — server-side HTML sanitization before storage (test
 * required 10, acceptance 12).
 */
describe('sanitizeHtml (spec 04 §11.6, test 10, acceptance 12)', () => {
    it('strips an onclick handler and a script tag, keeping the allowed text (acceptance 12, verified example)', () => {
        expect(sanitizeHtml('<p onclick="x()">hi</p><script>y()</script>')).toBe('<p>hi</p>');
    });
    it('strips a script tag entirely, including its body', () => {
        expect(sanitizeHtml('<p>before</p><script>alert(document.cookie)</script><p>after</p>')).toBe('<p>before</p><p>after</p>');
    });
    it('strips every on* event-handler attribute', () => {
        expect(sanitizeHtml('<p onmouseover="steal()" onerror="steal()">text</p>')).toBe('<p>text</p>');
    });
    it('strips a javascript: URL from an anchor href', () => {
        const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
        expect(result).not.toContain('javascript:');
    });
    it('allows an https href on an anchor and adds rel="noopener noreferrer"', () => {
        const result = sanitizeHtml('<a href="https://fabrillke.com/p/shirt">shirt</a>');
        expect(result).toContain('href="https://fabrillke.com/p/shirt"');
        expect(result).toContain('rel="noopener noreferrer"');
    });
    it('strips a style tag and inline style attributes', () => {
        const result = sanitizeHtml('<style>body{display:none}</style><p style="color:red">hi</p>');
        expect(result).not.toContain('<style>');
        expect(result).not.toContain('style=');
    });
    it('strips a disallowed tag (iframe) but keeps allowed sibling content', () => {
        const result = sanitizeHtml('<p>before</p><iframe src="https://evil.example.com"></iframe><p>after</p>');
        expect(result).not.toContain('<iframe');
        expect(result).toBe('<p>before</p><p>after</p>');
    });
    it('keeps basic formatting tags from the allowlist', () => {
        const result = sanitizeHtml('<p><strong>bold</strong> and <em>italic</em></p><ul><li>item</li></ul>');
        expect(result).toBe('<p><strong>bold</strong> and <em>italic</em></p><ul><li>item</li></ul>');
    });
    it('strips a data: URL from an anchor href', () => {
        const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
        expect(result).not.toContain('data:text/html');
    });
});
