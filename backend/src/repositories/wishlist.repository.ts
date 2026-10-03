import { run, type Db } from './db.js';

/** Wishlist persistence (spec 09) — products, not variants; registered customers only. */

/** Idempotent via UNIQUE (customer_id, product_id). Returns false when the product is not visible. */
export async function add(customerId: string, productId: string, db?: Db): Promise<boolean> {
  return run(db, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = $1 AND p.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
      [productId],
    );
    if (rows.length === 0) return false;
    await client.query(
      `INSERT INTO wishlist_items (customer_id, product_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, product_id) DO NOTHING`,
      [customerId, productId],
    );
    return true;
  });
}

export async function remove(customerId: string, productId: string, db?: Db): Promise<void> {
  await run(db, (client) =>
    client.query(`DELETE FROM wishlist_items WHERE customer_id = $1 AND product_id = $2`, [customerId, productId]),
  );
}

type WishlistRow = {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  base_price: string;
  compare_at_price: string | null;
  is_featured: boolean;
  image_url: string | null;
  category_id: string;
  category_name: string;
  out_of_stock: boolean;
};

/** Same shape as the public product list item; inactive products/categories simply drop out. */
export async function list(customerId: string, db?: Db) {
  return run(db, async (client) => {
    const { rows } = await client.query<WishlistRow>(
      `SELECT p.id, p.name, p.slug, p.sku, p.base_price, p.compare_at_price, p.is_featured,
              (SELECT pi.storage_path FROM product_images pi WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url,
              p.category_id, c.name AS category_name,
              NOT EXISTS (SELECT 1 FROM product_variants pv
                           WHERE pv.product_id = p.id AND pv.is_active AND pv.stock_quantity > 0) AS out_of_stock
         FROM wishlist_items w
         JOIN products p ON p.id = w.product_id
         JOIN categories c ON c.id = p.category_id
        WHERE w.customer_id = $1 AND p.status = 'ACTIVE' AND c.status = 'ACTIVE'
        ORDER BY w.created_at DESC`,
      [customerId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      basePrice: Number(row.base_price),
      compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
      isFeatured: row.is_featured,
      imageUrl: row.image_url,
      categoryId: row.category_id,
      categoryName: row.category_name,
      outOfStock: row.out_of_stock,
    }));
  });
}
