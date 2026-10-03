import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEY = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const originalValue = process.env[ENV_KEY];

async function loadWhatsapp(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
  return import('../src/lib/whatsapp');
}

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalValue;
  }
  vi.restoreAllMocks();
});

describe('whatsapp config (spec 12 §12.4, implementation spec 19)', () => {
  it('accepts a valid international number', async () => {
    const { whatsappNumber, isWhatsAppEnabled } = await loadWhatsapp('8801712345678');
    expect(whatsappNumber).toBe('8801712345678');
    expect(isWhatsAppEnabled).toBe(true);
  });

  it('fails closed when unset', async () => {
    const { whatsappNumber, isWhatsAppEnabled } = await loadWhatsapp(undefined);
    expect(whatsappNumber).toBeNull();
    expect(isWhatsAppEnabled).toBe(false);
  });

  it('fails closed when empty or whitespace-only', async () => {
    const { whatsappNumber: empty } = await loadWhatsapp('');
    expect(empty).toBeNull();

    const { whatsappNumber: whitespace } = await loadWhatsapp('   ');
    expect(whitespace).toBeNull();
  });

  it.each([
    ['+8801712345678', 'leading plus'],
    ['880-171-234-5678', 'dashes'],
    ['880 171 234 5678', 'spaces'],
    ['abc', 'non-digits'],
  ])('fails closed and rejects %s (%s)', async (value) => {
    const { whatsappNumber } = await loadWhatsapp(value);
    expect(whatsappNumber).toBeNull();
  });

  it('logs a development-mode warning for a malformed value, silent in production', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalNodeEnv = process.env.NODE_ENV;

    (process.env as Record<string, string>).NODE_ENV = 'development';
    await loadWhatsapp('+8801712345678');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockClear();
    (process.env as Record<string, string>).NODE_ENV = 'production';
    await loadWhatsapp('+8801712345678');
    expect(warnSpy).not.toHaveBeenCalled();

    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });
});

describe('buildWhatsAppLink (spec 12 §12.5, implementation spec 19)', () => {
  it('includes every field when all are present', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: 'TSH-001',
      selectedSize: 'M',
      selectedColour: 'Navy',
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    expect(link).not.toBeNull();
    const url = new URL(link!);
    expect(url.origin + url.pathname).toBe('https://wa.me/8801712345678');
    expect(url.searchParams.get('text')).toBe(
      'Hello, I am interested in Premium T-Shirt. Product ID: TSH-001. M, Navy. ' +
        'Is this product available? https://fabrillke.com/p/premium-t-shirt',
    );
  });

  it('omits the SKU clause cleanly when absent', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: null,
      selectedSize: 'M',
      selectedColour: 'Navy',
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    const text = new URL(link!).searchParams.get('text')!;
    expect(text).not.toContain('Product ID');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('omits the variant clause when nothing is selected', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: 'TSH-001',
      selectedSize: null,
      selectedColour: null,
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    const text = new URL(link!).searchParams.get('text')!;
    expect(text).toBe(
      'Hello, I am interested in Premium T-Shirt. Product ID: TSH-001. ' +
        'Is this product available? https://fabrillke.com/p/premium-t-shirt',
    );
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('includes only the selected size when colour is absent', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: null,
      selectedSize: 'M',
      selectedColour: null,
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    const text = new URL(link!).searchParams.get('text')!;
    expect(text).toContain('M.');
    expect(text).not.toContain('Navy');
  });

  it('includes only the selected colour when size is absent', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: null,
      selectedSize: null,
      selectedColour: 'Navy',
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    const text = new URL(link!).searchParams.get('text')!;
    expect(text).toContain('Navy');
    expect(text).not.toContain('M,');
  });

  it('round-trips punctuation and Bangla product names through encodeURIComponent', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const productName = `Men's Panjabi & Cap — "Eid" Special`;
    const link = buildWhatsAppLink({
      productName,
      productSku: null,
      selectedSize: null,
      selectedColour: null,
      canonicalUrl: 'https://fabrillke.com/p/eid-special',
    });

    const text = new URL(link!).searchParams.get('text')!;
    expect(text).toContain(productName);

    const banglaName = 'প্রিমিয়াম টি-শার্ট';
    const banglaLink = buildWhatsAppLink({
      productName: banglaName,
      productSku: null,
      selectedSize: null,
      selectedColour: null,
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt-bn',
    });
    const banglaText = new URL(banglaLink!).searchParams.get('text')!;
    expect(banglaText).toContain(banglaName);
  });

  it('returns null when the WhatsApp number is not configured', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp(undefined);
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: 'TSH-001',
      selectedSize: 'M',
      selectedColour: 'Navy',
      canonicalUrl: 'https://fabrillke.com/p/premium-t-shirt',
    });

    expect(link).toBeNull();
  });
});

describe('single source of truth (spec 12 §12.4, §12.7)', () => {
  it('no other frontend module references NEXT_PUBLIC_WHATSAPP_NUMBER or wa.me', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const srcDir = path.join(__dirname, '..', 'src');
    const allowedFile = path.join(srcDir, 'lib', 'whatsapp.ts');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(srcDir);

    const offenders = files.filter((file) => {
      if (file === allowedFile) return false;
      const content = fs.readFileSync(file, 'utf-8');
      return content.includes('NEXT_PUBLIC_WHATSAPP_NUMBER') || content.includes('wa.me');
    });

    expect(offenders).toEqual([]);
  });
});

describe('canonical URL and privacy (spec 12 §12.5, §12.8)', () => {
  it('uses exactly the canonical URL it is given, never window.location', async () => {
    const { buildWhatsAppLink } = await loadWhatsapp('8801712345678');
    const link = buildWhatsAppLink({
      productName: 'Premium T-Shirt',
      productSku: null,
      selectedSize: null,
      selectedColour: null,
      canonicalUrl: 'https://fabrillke.com/product/premium-t-shirt',
    });
    const text = new URL(link!).searchParams.get('text')!;
    expect(text.endsWith('https://fabrillke.com/product/premium-t-shirt')).toBe(true);
    expect(text).not.toContain('utm_');
  });

  it('WhatsAppLinkInput carries only product fields (no customer data)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'whatsapp.ts'), 'utf-8');
    const block = src.match(/export type WhatsAppLinkInput = \{([\s\S]*?)\};/)?.[1] ?? '';
    const fields = [...block.matchAll(/(\w+):/g)].map((m) => m[1]);
    expect(fields).toEqual(['productName', 'productSku', 'selectedSize', 'selectedColour', 'canonicalUrl']);
  });
});

describe('WhatsAppChatButton and placement (spec 12 §12.3, §12.6, §12.8)', () => {
  async function read(...parts: string[]) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf-8');
  }

  it('is a plain anchor with new-tab attributes, no window.open, no tracking', async () => {
    const src = await read('components', 'WhatsAppChatButton.tsx');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('<a');
    expect(code).toContain('target="_blank"');
    expect(code).toContain('rel="noopener noreferrer"');
    expect(code).not.toMatch(/window\.open|onClick|track\(|analytics/);
    expect(code).toContain('if (!href) return null');
  });

  it('pairs Buy Now / Add to Wishlist with WhatsApp by stock, WhatsApp in both branches', async () => {
    const src = await read('components', 'product', 'ProductDetail.tsx');
    const outOfStockBranch = src.slice(src.indexOf('{isOutOfStock ? ('), src.indexOf('<WhatsAppChatButton'));
    const [wishlistPart, inStockPart] = outOfStockBranch.split(') : (');
    // The labelled "Add to Wishlist" action is the shared <WishlistButton variant="button" /> (spec 09).
    expect(wishlistPart).toMatch(/<WishlistButton[^>]*variant="button"/);
    expect(wishlistPart).not.toContain('Buy Now');
    expect(inStockPart).toContain('Buy Now');
    expect(src.match(/<WhatsAppChatButton/g)).toHaveLength(1); // outside the ternary => both branches
  });
});

describe('no backend footprint (spec 12 §12.1, §12.2)', () => {
  it('no backend source or migration references WhatsApp', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const backendSrc = path.join(__dirname, '..', '..', 'backend', 'src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|sql)$/.test(entry.name) && /whatsapp|wa\.me/i.test(fs.readFileSync(full, 'utf-8'))) hits.push(full);
      }
    };
    walk(backendSrc);
    expect(hits).toEqual([]);
  });
});
