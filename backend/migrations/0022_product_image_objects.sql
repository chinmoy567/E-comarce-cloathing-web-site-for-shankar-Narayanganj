-- 0022_product_image_objects.sql — spec 06 (product images)
-- Links a product image to the stored object behind it. `product_images.storage_path`
-- keeps holding the PUBLIC URL (every storefront reader — cart, wishlist, CMS lookups,
-- the product page — already treats it as the image URL); the object's bucket path lives
-- in `storage_objects`, so deleting an image can remove the stored object too.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS storage_object_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_images_storage_object_id_fkey'
  ) THEN
    ALTER TABLE product_images
      ADD CONSTRAINT product_images_storage_object_id_fkey
      FOREIGN KEY (storage_object_id) REFERENCES storage_objects (id);
  END IF;
END
$$;
