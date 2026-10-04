import { describe, expect, it } from 'vitest';
import { moveImage } from '../src/lib/admin/productImages';
import { validateImageFile } from '../src/lib/imageUpload';

describe('moveImage', () => {
  const ids = ['a', 'b', 'c'];

  it('swaps an image with its neighbour', () => {
    expect(moveImage(ids, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveImage(ids, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('returns null at the ends and for an unknown id, and never mutates the input', () => {
    expect(moveImage(ids, 'a', -1)).toBeNull();
    expect(moveImage(ids, 'c', 1)).toBeNull();
    expect(moveImage(ids, 'zzz', 1)).toBeNull();
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('validateImageFile', () => {
  it('accepts JPG, PNG and WebP up to 5 MB and rejects everything else', () => {
    expect(validateImageFile({ type: 'image/webp', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/svg+xml', size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(validateImageFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(validateImageFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});
