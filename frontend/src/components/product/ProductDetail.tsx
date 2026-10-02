'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { WhatsAppChatButton } from '@/components/WhatsAppChatButton';
import { addToCart } from '@/lib/cart';
import { track } from '@/lib/analytics';
import { TrackEvent } from '@/components/TrackEvent';
import { CURRENCY, META_EVENTS } from '@shared/analytics';
import type { PublicProductDetail } from '@/lib/publicTypes';

/**
 * Product detail page body (spec 02 §"View detailed product information",
 * "Select product variants"; spec 12 §12.3–12.8 WhatsApp contact).
 *
 * Client component: variant selection (size/colour) is interactive state
 * that determines price, stock, and the WhatsApp message contents.
 */
export function ProductDetail({ product, canonicalUrl }: { product: PublicProductDetail; canonicalUrl: string }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  const attributeGroups = useMemo(() => {
    const groups = new Map<string, { attributeId: string; name: string; type: string; values: Map<string, string> }>();
    for (const variant of product.variants) {
      for (const attr of variant.attributes) {
        const group = groups.get(attr.attributeId) ?? {
          attributeId: attr.attributeId,
          name: attr.name,
          type: attr.type,
          values: new Map<string, string>(),
        };
        group.values.set(attr.valueId, attr.value);
        groups.set(attr.attributeId, group);
      }
    }
    return [...groups.values()];
  }, [product.variants]);

  const [selectedValueIds, setSelectedValueIds] = useState<Record<string, string>>({});

  const selectedVariant = useMemo(() => {
    if (product.variants.length === 0) return null;
    if (attributeGroups.length === 0) return product.variants[0] ?? null;

    const allSelected = attributeGroups.every((group) => selectedValueIds[group.attributeId]);
    if (!allSelected) return null;

    return (
      product.variants.find((variant) =>
        variant.attributes.every((attr) => selectedValueIds[attr.attributeId] === attr.valueId),
      ) ?? null
    );
  }, [attributeGroups, product.variants, selectedValueIds]);

  const displayPrice = selectedVariant?.price ?? product.minPrice;
  const displayCompareAtPrice = selectedVariant?.compareAtPrice ?? product.compareAtPrice;
  const isOutOfStock = selectedVariant ? !selectedVariant.inStock : product.outOfStock;

  const sizeValue = selectedVariant?.attributes.find((a) => a.type === 'SIZE')?.value ?? null;
  const colourValue = selectedVariant?.attributes.find((a) => a.type === 'COLOUR')?.value ?? null;

  const whatsAppHref = buildWhatsAppLink({
    productName: product.name,
    productSku: selectedVariant?.sku ?? product.sku,
    selectedSize: sizeValue,
    selectedColour: colourValue,
    canonicalUrl,
  });

  const primaryImage = product.images[0] ?? null;

  function variantDescription(): string | null {
    if (!selectedVariant || selectedVariant.attributes.length === 0) return null;
    return selectedVariant.attributes.map((a) => `${a.name}: ${a.value}`).join(', ');
  }

  function handleAddToCart() {
    addToCart({
      productId: product.id,
      variantId: selectedVariant?.id ?? null,
      quantity,
      displaySnapshot: {
        productName: product.name,
        variantDescription: variantDescription(),
        unitPrice: displayPrice,
        imageUrl: primaryImage?.url ?? null,
        slug: product.slug,
      },
    });
    track(META_EVENTS.ADD_TO_CART, {
      content_ids: [selectedVariant?.id ?? product.id],
      content_type: 'product',
      content_name: product.name,
      contents: [{ id: selectedVariant?.id ?? product.id, quantity, item_price: displayPrice }],
    });
    setAddedMessage(`Added ${quantity} to cart.`);
  }

  function handleBuyNow() {
    handleAddToCart();
    router.push('/cart');
  }

  return (
    <div className="mx-auto max-w-7xl px-lg py-2xl">
      <TrackEvent
        name={META_EVENTS.VIEW_CONTENT}
        payload={{
          content_ids: [product.id],
          // Ids + quantity only: the backend recomputes the CAPI value from the catalogue (§8.31).
          contents: [{ id: product.id, quantity: 1, item_price: product.minPrice }],
          content_type: 'product',
          content_name: product.name,
          value: product.minPrice,
          currency: CURRENCY,
        }}
      />
      <div className="grid grid-cols-1 gap-xl md:grid-cols-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface">
          {primaryImage ? (
            <Image src={primaryImage.url} alt={primaryImage.altText ?? product.name} fill className="object-cover" priority />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-tertiary text-sm">No image</div>
          )}
        </div>

        <div className="flex flex-col gap-md">
          <div>
            <p className="text-xs text-text-tertiary">{product.category.name}</p>
            <h1 className="mt-xs text-2xl font-bold text-text-primary md:text-3xl">{product.name}</h1>
          </div>

          <div className="flex items-baseline gap-sm">
            <span className="text-2xl font-bold text-primary">৳{displayPrice.toLocaleString('en-BD')}</span>
            {displayCompareAtPrice !== null && displayCompareAtPrice > displayPrice && (
              <span className="text-sm text-text-tertiary line-through">
                ৳{displayCompareAtPrice.toLocaleString('en-BD')}
              </span>
            )}
          </div>

          <p className={`text-sm font-semibold ${isOutOfStock ? 'text-error' : 'text-success'}`}>
            {isOutOfStock ? 'Out of stock' : 'In stock'}
          </p>

          {attributeGroups.map((group) => (
            <div key={group.attributeId}>
              <p className="mb-sm text-xs font-semibold text-text-primary">{group.name}</p>
              <div className="flex flex-wrap gap-sm">
                {[...group.values.entries()].map(([valueId, value]) => {
                  const isSelected = selectedValueIds[group.attributeId] === valueId;
                  return (
                    <button
                      key={valueId}
                      type="button"
                      onClick={() =>
                        setSelectedValueIds((prev) => ({ ...prev, [group.attributeId]: valueId }))
                      }
                      className={`min-h-[44px] min-w-[44px] rounded-lg border-2 px-md text-sm font-medium ${
                        isSelected
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-white text-text-primary hover:border-primary'
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {product.description && (
            <div>
              <p className="mb-xs text-xs font-semibold text-text-primary">Description</p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{product.description}</p>
            </div>
          )}

          {!isOutOfStock && (
            <div>
              <p className="mb-sm text-xs font-semibold text-text-primary">Quantity</p>
              <div className="flex items-center gap-sm">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-lg font-bold text-text-primary hover:border-primary"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="min-w-[2ch] text-center text-base font-semibold text-text-primary">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-lg font-bold text-text-primary hover:border-primary"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          )}

          <div className="mt-md flex flex-col gap-sm md:flex-row">
            {isOutOfStock ? (
              <button
                type="button"
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border-2 border-primary bg-white px-4 text-sm font-bold text-primary md:w-auto"
              >
                Add to Wishlist
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={attributeGroups.length > 0 && !selectedVariant}
                  onClick={handleAddToCart}
                  className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg border-2 border-primary bg-white px-4 text-sm font-bold text-primary disabled:opacity-50 md:w-auto"
                >
                  Add to Cart
                </button>
                <button
                  type="button"
                  disabled={attributeGroups.length > 0 && !selectedVariant}
                  onClick={handleBuyNow}
                  className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50 md:w-auto"
                >
                  Buy Now
                </button>
              </>
            )}
            <WhatsAppChatButton href={whatsAppHref} />
          </div>

          {addedMessage && (
            <p role="status" className="text-sm font-medium text-accent">
              {addedMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
