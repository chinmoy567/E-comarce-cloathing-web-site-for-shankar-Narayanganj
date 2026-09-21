# 06 — Supabase Storage, Product Image Upload, and the Shared Upload Pipeline

## Goal

After this slice the platform can accept, validate, store, and serve uploaded files through Supabase Storage, entirely behind the Express backend. Admin/Manager users can upload, reorder, set primary, replace, and delete product and category images; the storefront and back-office render them through Next.js Image optimization. The same upload pipeline built here is the one spec 11 uses for bKash payment screenshots and spec 17 uses for homepage/campaign imagery — with the crucial difference that product images are public-readable while payment screenshots are private and reachable only through an authorized, permission-checked backend endpoint.

## Requirement references

- `01-overview.md` §1.1 — Supabase Storage for product images and other uploaded files (e.g. bKash payment screenshots); all access via the Express backend with the service-role key; the browser never talks to Supabase directly.
- `05-admin-operations.md` §5.1 — "Upload and manage product images" as a catalogue capability.
- `06-rbac.md` §5.18 — `Product Image Management` (Yes / Yes) gates image operations; `CMS Management` (Yes / Assigned) gates homepage/campaign imagery (used by spec 17).
- `11-security-hardening.md` §11.4 — a larger, separately-bounded body limit only for the specific upload endpoints that need it, additionally restricted by file type and size.
- `11-security-hardening.md` §11.6 — file uploads validated by **actual content/MIME type, not just extension**, re-encoded or scanned before storage where feasible, and stored in Supabase Storage rather than served from an executable path.
- `13-homepage-cms.md` §13.11 — section/campaign imagery uses the **existing** Supabase Storage mechanism used for product images; no second storage integration; desktop and mobile images configured independently with fallback.
- `03-payment-order.md` §3.1 — the customer uploads a bKash payment screenshot; `05-admin-operations.md` §5.2–5.3 — Admin/Manager views it.
- `04-courier-shipment.md` §4.16, `02-customer.md` §2.9.6 — payment proof must never appear in public/customer-facing responses.
- `08-analytics-meta.md` §6.6 — payment screenshots must never be sent to Meta.
- `design` skill — Images section (alt text required, WebP with fallback, lazy loading, no background images, product images square 1:1); Performance (images under ~100KB, optimized).
- `seo` skill §5, §8 — `og:image` uses a real product image at a size that renders in link previews; Next.js `Image` optimization and lazy loading below the fold.

## Depends on

- **01** — Express app, error taxonomy, validation, env loading, the Supabase service-role client.
- **02** — `audit_logs`, `withTransaction`.
- **03** — `requireAuth('admin')`, `requirePermission`.
- **04** — `validateUpload` (content-sniffing MIME/size validator), `createUploadLimit`, the CSP whose `img-src` must include the storage host, `authenticatedCeiling`.
- **05** — `products`, `categories`, `product_images` (table and the one-primary-per-product partial unique index).

## Scope

**In scope**

- Two Supabase Storage buckets: `product-images` (public read) and `payment-proofs` (private).
- A shared `StorageService` wrapping upload, delete, signed-URL issuance, and public-URL construction — the only module in the codebase that talks to Supabase Storage.
- A shared `uploadMiddleware` (multipart parsing with a per-route byte cap) plus image normalization (re-encode to WebP, strip EXIF, bound dimensions).
- Product image endpoints: upload, list, reorder, set primary, update alt text, delete.
- Category image upload/clear.
- A private-object read endpoint pattern (permission-checked, short-lived signed URL) that spec 11 reuses verbatim for payment screenshots.
- Orphan cleanup: deleting a product or image removes the stored object in the same operation.
- Frontend: admin image manager component (upload, drag/move ordering, primary selection, alt text), plus the shared `<ProductImage />` wrapper around `next/image`.

**Out of scope / deferred**

- The bKash screenshot **upload endpoint and its business rules** — deferred to spec **11**, which owns payment submission. This slice provides the private bucket, the validator, the normalizer, and the signed-URL read pattern so spec 11 adds only the payment-specific route.
- Homepage/campaign imagery endpoints — deferred to spec **17**, which reuses this pipeline unchanged (§13.11).
- Storefront rendering of product galleries — deferred to spec **07**.
- Virus scanning — §11.6 says "re-encoded or scanned before storage **where feasible**"; re-encoding is implemented, scanning is not. See Open questions.
- A CDN in front of storage — §11.4 makes the CDN a deployment concern.

## Database changes

Migration file: `backend/migrations/0006_storage_objects.sql`

`product_images` already exists from spec 05 and is unchanged. One new table tracks every stored object so deletions never leak orphans and so private objects carry their access classification in the database rather than only in a bucket name.

### `storage_objects`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `bucket` | `text` | NOT NULL | — | `product-images` \| `payment-proofs` |
| `object_path` | `text` | NOT NULL | — | Path within the bucket |
| `visibility` | `storage_visibility` | NOT NULL | — | `PUBLIC` \| `PRIVATE` |
| `mime_type` | `text` | NOT NULL | — | Sniffed type, not the declared one |
| `byte_size` | `integer` | NOT NULL | — | Post-normalization size |
| `width` / `height` | `integer` | NULL | — | For images |
| `checksum_sha256` | `text` | NOT NULL | — | Of the stored bytes |
| `uploaded_by` | `uuid` | NULL | — | FK → `users(id)`; NULL for a guest's payment screenshot |
| `owner_entity_type` | `text` | NULL | — | `product` \| `category` \| `payment` \| `homepage_section` \| `campaign` |
| `owner_entity_id` | `uuid` | NULL | — | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `deleted_at` | `timestamptz` | NULL | — | Set when the object is removed from the bucket |

```sql
CREATE TYPE storage_visibility AS ENUM ('PUBLIC', 'PRIVATE');
```

- `UNIQUE (bucket, object_path)`.
- Index on `(owner_entity_type, owner_entity_id)`.
- `product_images.storage_path` is matched to `storage_objects.object_path` within the `product-images` bucket. `product_images` remains the ordering/primary-flag source of truth; `storage_objects` is the physical-object registry.

### Bucket setup

Buckets are created by a migration-adjacent setup script (`npm run storage:init`), idempotently:

| Bucket | Public | Max bytes | Allowed MIME |
| --- | --- | --- | --- |
| `product-images` | yes (read) | 5 MB pre-normalization | `image/jpeg`, `image/png`, `image/webp` |
| `payment-proofs` | **no** | 5 MB pre-normalization | `image/jpeg`, `image/png`, `image/webp` |

Public read on `product-images` means an anonymous `GET` of the object URL works — necessary for Next.js Image optimization and for `og:image` to be fetchable by crawlers (`seo` skill §5). **Write is never public**: uploads always go through the Express backend with the service-role key (§1.1). No signed upload URL is ever handed to the browser, because that would be the browser talking to Supabase directly, which this rule forbids.

`payment-proofs` is private with **no** public read. It is reachable only through the permission-checked backend endpoint described below.

## Backend work

### `StorageService` (`src/services/storage.service.ts`)

The only module that imports the Supabase Storage client.

```ts
uploadObject(input: {
  bucket: 'product-images' | 'payment-proofs';
  buffer: Buffer;
  declaredMimeType: string;
  ownerEntityType: string | null;
  ownerEntityId: string | null;
  uploadedBy: string | null;
}): Promise<StorageObject>;

deleteObject(objectId: string): Promise<void>;
getPublicUrl(objectId: string): string;               // product-images only
createSignedUrl(objectId: string, ttlSeconds: number): Promise<string>;  // payment-proofs
```

`uploadObject` sequence:

1. `validateUpload(buffer, { allowedMimeTypes, maxBytes })` from spec 04 — sniffs magic bytes and rejects when the content disagrees with the declared type or the extension (§11.6). SVG and HTML are never allowlisted.
2. **Normalize**: re-encode to WebP via `sharp`, strip all EXIF/metadata, cap the longest edge at 2000px. This is §11.6's "re-encoded… before storage" and it neutralizes polyglot files, embedded scripts, and EXIF location data in one step. A JPEG fallback copy is also written for `og:image` consumers that do not accept WebP (`design`: "WebP format with JPEG fallback").
3. Generate the object path as `<entityType>/<entityId>/<uuid>.<ext>`. **The client's filename is never used** — it is not stored and never forms part of a path, so a crafted filename cannot traverse directories or influence the served content type.
4. Upload with an explicit `contentType` from the sniffed value and `cacheControl` of one year (objects are immutable; a replacement gets a new UUID path).
5. Insert the `storage_objects` row.

`deleteObject` removes the bucket object and sets `deleted_at` in one operation; if the bucket delete fails, the row is left intact and the error surfaces, so the registry never claims an object is gone while it is still served.

### Routes

All under `/api/admin`, all with `requireAuth('admin')` + `rateLimit('authenticatedCeiling')`.

| Method | Path | Permission | Body limit |
| --- | --- | --- | --- |
| `POST` | `/catalogue/products/:productId/images` | `product.image.manage` | 5 MB multipart |
| `GET` | `/catalogue/products/:productId/images` | `product.update` | — |
| `PATCH` | `/catalogue/products/:productId/images/order` | `product.image.manage` | 100 kb |
| `PATCH` | `/catalogue/images/:imageId` | `product.image.manage` | 100 kb |
| `POST` | `/catalogue/images/:imageId/primary` | `product.image.manage` | 100 kb |
| `DELETE` | `/catalogue/images/:imageId` | `product.image.manage` | — |
| `POST` | `/catalogue/categories/:categoryId/image` | `category.manage` | 5 MB multipart |
| `DELETE` | `/catalogue/categories/:categoryId/image` | `category.manage` | — |

Plus the private-read pattern that spec 11 reuses:

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/storage/private/:objectId/url` | route-specific (see below) | Returns a short-lived signed URL |

The private-read endpoint takes the required permission from the object's `owner_entity_type`: a `payment` object requires `payment.view` (§5.18 "bKash Payment View"). The endpoint refuses any object whose `visibility` is `PUBLIC` (use the public URL) and any object type it has no mapping for — an unmapped type fails closed rather than defaulting to "allowed".

### Types

```ts
type ProductImageResponse = {
  id: string;
  url: string;            // public CDN/storage URL
  altText: string | null;
  displayOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
};

// POST .../images  (multipart/form-data: file, altText?)
type UploadImageResponse = ProductImageResponse;

// PATCH .../images/order
type ReorderImagesRequest = { imageIds: string[] };   // full ordered list, not a delta

// PATCH /catalogue/images/:imageId
type UpdateImageRequest = { altText: string | null };

// GET /storage/private/:objectId/url
type SignedUrlResponse = { url: string; expiresAt: string };
```

### Service rules and transaction boundaries

**Upload** — inside `withTransaction`: upload the object (bucket write happens first, since it cannot participate in the database transaction), then insert `storage_objects` and `product_images`. If the database insert fails, the already-uploaded bucket object is deleted in a compensating step before the error is returned, so a failed upload leaves no orphan. The reverse order (row first, object second) is not used, because it would leave a row pointing at a nonexistent object, which is the worse failure — a broken image on the storefront rather than a few stray bytes.

**Set primary** — inside `withTransaction`: clear `is_primary` on the product's other images, then set it on the target. The partial unique index from spec 05 makes a two-primary state impossible even under concurrency; the transaction makes the swap atomic so there is never a window with zero primaries.

**Reorder** — one request carrying the **full ordered list**, applied in a single transaction. This mirrors §13.12's reordering rule ("in a single request, not one request per row, to avoid an inconsistent intermediate order if the request is interrupted partway") and applies the same reasoning to image ordering.

**Delete** — inside `withTransaction`: delete the `product_images` row, mark the `storage_object` deleted, remove the bucket object. If the deleted image was primary and other images remain, the lowest `display_order` image is promoted, so a product never ends up with images but no primary.

**Product/category deletion cascade** — spec 05's delete path calls `StorageService.deleteObject` for every owned image before removing the parent, so deleting a product does not leak objects.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| No file in the request | 400 | `FILE_REQUIRED` |
| Content type disagrees with bytes, or type not allowlisted | 400 | `UNSUPPORTED_FILE_TYPE` |
| File exceeds the route's byte cap | 413 | `FILE_TOO_LARGE` |
| Corrupt/undecodable image | 400 | `INVALID_IMAGE` |
| Image count for a product exceeds the maximum (10) | 409 | `IMAGE_LIMIT_REACHED` |
| Reorder list does not exactly match the product's image set | 400 | `VALIDATION_ERROR` |
| Signed URL requested for a public object | 400 | `NOT_A_PRIVATE_OBJECT` |
| Signed URL requested without the object's required permission | 403 | `FORBIDDEN` |
| Bucket write fails | 502 | `UPSTREAM_ERROR` (generic message; the Supabase error is logged, never returned) |

## Frontend work

- **`<ImageManager />`** in the product editor (`/admin/catalogue/products/[id]`, spec 05): a grid of image thumbnails with an upload control ("Tap to upload or take photo", 60px tall, full width — matching the `design` skill's upload-button spec from the bKash screenshot screen so both uploads look and behave the same), Move Up/Down controls (44×44px, an acceptable equivalent to drag-and-drop per §13.12's reasoning), a "Set as primary" action, and an alt-text field per image. Alt text is presented as required, with a visible hint, because the `design` skill's Images rule requires descriptive alt text.
- Client-side, the file is checked for type and size **before** upload purely to give fast feedback; per the `frontend` skill §2 this is UX only and the backend's rejection is still handled and displayed.
- Upload states: idle → selected (preview) → uploading (progress) → success / error with the backend's message. No optimistic insertion into the gallery before the server confirms.
- **`<ProductImage />`** — a thin wrapper over `next/image` with `sizes` set for the 2-column mobile grid, `loading="lazy"` below the fold and `priority` for the first gallery image (`seo` skill §8, Core Web Vitals), square 1:1 aspect for product contexts (`design`: Product card / gallery), and a neutral placeholder when a product has no image (never a broken-image icon).
- The storage host is added to `next.config` `images.remotePatterns` and to the CSP `img-src` from spec 04.
- No Supabase client in the frontend; uploads `POST` multipart to the Express endpoint (`frontend` skill §1).

## Security requirements

- **Uploads never bypass the backend.** No signed upload URL or storage key reaches the browser; every write goes through Express with the service-role key (§1.1). A direct-to-Supabase upload path would be a Critical violation of the access model (`security` skill §0).
- **Content-based validation** (§11.6): magic-byte sniffing, not extension or declared `Content-Type`. SVG and HTML are never allowlisted, since they execute in a browsing context (`security` skill §6: "uploaded SVG/HTML can't become stored XSS").
- **Re-encoding** (§11.6) strips embedded payloads and EXIF (including GPS coordinates that would otherwise be customer PII stored alongside a product photo).
- **Client filenames are discarded**; paths are server-generated UUIDs, so path traversal and content-type confusion via filename are structurally impossible.
- **Separately-bounded body limits** (§11.4): the global 100 kb limit stays everywhere; only these upload routes get the 5 MB multipart parser, and the cap is enforced by the parser before the whole body is buffered.
- **Private bucket for payment proof.** `payment-proofs` has no public read. Signed URLs are short-lived (default 120 s, env-configurable) and issued only after a `payment.view` check. This is what makes §2.9.6's and §4.16's prohibitions ("payment proof… must never appear in the guest order-lookup or Track Order response") enforceable rather than merely conventional — a customer-facing endpoint cannot produce a usable URL even by accident.
- **Permission enforcement** on every route per §5.18; image management is a distinct matrix row (`Product Image Management`) and is checked as such.
- **No credential leakage**: Supabase errors are logged server-side and returned to clients as a generic `UPSTREAM_ERROR` — bucket names, keys, and internal paths never appear in a response.
- **Object URLs are unguessable** (UUID paths), so public-bucket objects are not enumerable even though read is public.
- **Audit**: every upload, delete, primary change, and reorder appends an `audit_logs` row with actor and entity (§5.15 rule 10).

## Data integrity / idempotency

- **No orphaned objects.** A failed database write triggers a compensating bucket delete; a product/category delete removes its objects first. The `storage_objects` registry makes an orphan detectable by query rather than invisible.
- **No dangling references.** Objects are uploaded before rows are written, so a `product_images` row never points at a nonexistent object.
- **Exactly one primary image** is guaranteed by spec 05's partial unique index, not by application discipline; the set-primary swap runs in one transaction so there is no zero-primary window, and deleting the primary promotes a successor.
- **Immutable objects.** Replacing an image writes a new UUID path rather than overwriting, so a long-lived cache or an in-flight `og:image` fetch never sees a half-written object; this is also why a one-year `cacheControl` is safe.
- **Reorder is one atomic request**, so an interrupted reorder leaves the previous order intact rather than a partial permutation (the same reasoning §13.12 applies to homepage sections).
- **Repeated uploads of identical bytes** create separate objects by design (each has its own lifecycle); `checksum_sha256` is recorded for auditing and deduplication reporting, not to silently merge rows.

## Acceptance criteria

1. `npm run storage:init` creates both buckets; re-running changes nothing and exits 0.
2. `POST /api/admin/catalogue/products/:id/images` with a valid JPEG as Admin returns 201 with a public `url` that loads anonymously in a browser.
3. The stored object is WebP, has no EXIF (verified with `exiftool` or equivalent), and its longest edge is ≤ 2000px, regardless of the input dimensions.
4. Uploading a file named `evil.png` whose bytes are a PHP script returns 400 `UNSUPPORTED_FILE_TYPE`, and nothing is written to the bucket or to `storage_objects`.
5. Uploading an SVG returns 400 `UNSUPPORTED_FILE_TYPE`.
6. Uploading a 9 MB image returns 413 `FILE_TOO_LARGE`; a normal `POST` with a 200 kb JSON body to a non-upload route still returns 413, proving the 5 MB limit did not leak globally.
7. The stored object path contains no part of the uploaded filename.
8. A Manager uploading an image returns 201 (`Product Image Management` is `Yes` for Manager); revoking that specific key in the test fixture and retrying returns 403, proving the route checks `product.image.manage` and not some broader permission.
9. `POST /catalogue/images/:id/primary` makes exactly one image primary; `SELECT count(*) FROM product_images WHERE product_id = $1 AND is_primary` is 1 before and after.
10. Deleting the primary image promotes the next image; deleting the last image leaves the product with zero images and no error.
11. `PATCH .../images/order` with a list missing one of the product's images returns 400 and changes nothing.
12. `DELETE /catalogue/images/:id` removes the bucket object — a subsequent anonymous `GET` of the old URL returns 404 — and sets `deleted_at`.
13. An anonymous `GET` of a `payment-proofs` object URL returns 403/404; it is never publicly readable.
14. `GET /api/admin/storage/private/:objectId/url` for a payment object as a user with `payment.view` returns a URL that works, and stops working after the TTL elapses.
15. The same request from a user without `payment.view` returns 403; from an unauthenticated caller returns 401.
16. Forcing a database failure after a successful bucket write leaves no object in the bucket (compensating delete ran) and no row in `storage_objects`.
17. Deleting a product removes all of its image objects from the bucket.
18. Every upload/delete/primary/reorder produces an `audit_logs` row naming the actor.
19. A product page at 375px renders the image at 1:1 with lazy loading below the fold and no layout shift.

## Tests required

Per the `test` skill §4 (input validation / upload vectors) and §5 (standard coverage for catalogue-adjacent features):

1. **Content-type sniffing beats the declared type and the extension** (§11.6) — a `.png`-named PHP script, a `.jpg`-named HTML file, and a real JPEG declared as `image/gif` are all rejected; a genuine JPEG/PNG/WebP is accepted. This is the named business rule: uploads are validated by actual content, not extension.
2. **SVG and HTML are never accepted** (`security` §6, stored XSS via uploaded markup).
3. **Size cap enforced per route** (§11.4) — oversize rejected; the global 100 kb limit still applies to non-upload routes.
4. **Re-encoding strips metadata** (§11.6) — an input JPEG carrying EXIF GPS produces a stored object with no EXIF.
5. **Client filename never influences the stored path** — a filename containing `../` and one containing a null byte both produce a UUID path inside the expected prefix.
6. **Payment-proof objects are not publicly readable** (§2.9.6, §4.16) — anonymous access to the private bucket fails. This is the structural guard behind "payment proof must never be exposed to customers."
7. **Signed URL requires the mapped permission** (§5.18 `payment.view`) — allowed with it, 403 without it, 401 unauthenticated; and an object type with no permission mapping fails closed.
8. **Signed URL expires** — usable before the TTL, rejected after.
9. **Exactly one primary image** — concurrent set-primary calls leave exactly one; deleting the primary promotes a successor.
10. **Reorder is atomic and total** — a partial list is rejected; a valid list applies fully.
11. **No orphans on failure** — a simulated database failure after upload leaves no bucket object; a simulated bucket-delete failure leaves the row intact rather than falsely marking it deleted.
12. **Cascade on product delete** — all owned objects removed.
13. **Permission matrix rows** (§5.18) — `product.image.manage` and `category.manage` checked on their respective routes.
14. **Audit rows written** for upload, delete, primary change, reorder (§5.15 rule 10).

## Open questions / assumptions

1. **Virus/malware scanning.** §11.6 says uploads are "re-encoded or scanned before storage **where feasible**" — an either/or. *Assumption:* re-encoding through `sharp` is implemented and satisfies the clause for image uploads, since re-encoding destroys embedded payloads far more reliably than signature scanning would for images. No AV scanner is added, as that would be speculative infrastructure beyond §11.10's scope. **Flagged** if the client requires scanning for compliance reasons.
2. **`sharp` as a dependency.** CLAUDE.md §2 fixes the stack but does not forbid libraries. *Assumption:* `sharp` is an ordinary image-processing library, not a "major technology," and is required to satisfy §11.6's re-encoding clause and the `design` skill's WebP requirement. If re-encoding were dropped, the upload path would have to rely on sniffing alone, which is weaker.
3. **Public read on `product-images`.** §1.1 says the browser never talks to Supabase directly "with an end-user-scoped key," in the context of *database* access and authorization. *Assumption:* anonymous HTTP `GET` of a public product image is not "talking to Supabase with a key" and is required for Next.js Image optimization and for crawler-fetchable `og:image` (`seo` §5). All **writes** remain backend-only. If the client prefers every image to be proxied through Express, that is a performance trade-off, not a correctness one, and only `getPublicUrl` changes.
4. **Image count and size limits.** No PRD gives a maximum image count per product or a maximum upload size; §11.4 only says the limit must be "separately bounded." *Assumption:* 10 images per product and a 5 MB pre-normalization cap, both env-configurable. The `design` skill's "< 100KB each" target refers to the **delivered** image, which WebP re-encoding plus Next.js optimization achieves from a larger source.
5. **Signed URL TTL.** Not specified. *Assumption:* 120 seconds, env-configurable — long enough to render an admin screenshot view, short enough that a leaked URL is near-useless.
6. **Alt text.** The `design` skill requires descriptive alt text on all images, but no PRD makes it mandatory at upload. *Assumption:* the field is required in the admin UI and nullable in the schema, so pre-existing rows are not invalidated; an empty alt is rendered as `alt=""` (decorative) rather than as the filename.
