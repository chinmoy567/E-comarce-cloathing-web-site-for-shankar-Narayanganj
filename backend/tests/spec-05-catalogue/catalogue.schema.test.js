import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, connect, dropSchema, resetSchema } from '../helpers/schemaFixture.ts';
/**
 * Spec 05 — raw-SQL constraint tests (S3), bypassing repositories entirely.
 * Tests required item 5 ("Database rejects negative stock — the CHECK
 * constraint, tested at the data layer, not via the service") and acceptance
 * criteria 6 and 14 (no `out_of_stock` column; direct negative UPDATE
 * rejected).
 *
 * One `pg.Client`, `BEGIN`/`ROLLBACK` per case, matching
 * `schema.identity.test.ts`'s pattern — a mock asserts nothing about a
 * Postgres CHECK constraint.
 */
const SCHEMA = 'spec05_catalogue_schema';
describe.skipIf(!TEST_DATABASE_URL)('catalogue schema constraints (spec 05)', () => {
    let db;
    let categoryId;
    let productId;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        db = await connect(SCHEMA);
        const category = await db.query(`INSERT INTO categories (name, slug) VALUES ('Schema Test', 'schema-test') RETURNING id`);
        categoryId = category.rows[0].id;
        const product = await db.query(`INSERT INTO products (category_id, name, slug, base_price)
       VALUES ($1, 'Schema Test Product', 'schema-test-product', 100)
       RETURNING id`, [categoryId]);
        productId = product.rows[0].id;
    }, 60_000);
    afterAll(async () => {
        await db.end();
        await dropSchema(SCHEMA);
    });
    beforeEach(async () => {
        await db.query('BEGIN');
    });
    afterEach(async () => {
        await db.query('ROLLBACK');
    });
    it('rejects a direct SQL UPDATE that would leave stock_quantity negative (acceptance 14, test 5)', async () => {
        const variant = await db.query(`INSERT INTO product_variants (product_id, stock_quantity) VALUES ($1, 0) RETURNING id`, [productId]);
        const variantId = variant.rows[0].id;
        await expect(db.query(`UPDATE product_variants SET stock_quantity = -1 WHERE id = $1`, [variantId])).rejects.toMatchObject({ code: '23514', constraint: 'product_variants_stock_quantity_check' });
    });
    it('rejects an INSERT with a negative stock_quantity (test 5)', async () => {
        await expect(db.query(`INSERT INTO product_variants (product_id, stock_quantity) VALUES ($1, -5)`, [productId])).rejects.toMatchObject({ code: '23514', constraint: 'product_variants_stock_quantity_check' });
    });
    it('has no column named out_of_stock on products (acceptance 6)', async () => {
        const result = await db.query(`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'products' AND table_schema = $1`, [SCHEMA]);
        const columnNames = result.rows.map((row) => row.column_name);
        expect(columnNames).not.toContain('out_of_stock');
    });
    it('has no column named out_of_stock on product_variants either', async () => {
        const result = await db.query(`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'product_variants' AND table_schema = $1`, [SCHEMA]);
        const columnNames = result.rows.map((row) => row.column_name);
        expect(columnNames).not.toContain('out_of_stock');
    });
    it('rejects a compare_at_price below base_price (products_compare_at_price_check)', async () => {
        await expect(db.query(`INSERT INTO products (category_id, name, slug, base_price, compare_at_price)
         VALUES ($1, 'Bad Compare', 'bad-compare', 100, 50)`, [categoryId])).rejects.toMatchObject({ code: '23514', constraint: 'products_compare_at_price_check' });
    });
    it('rejects a category whose parent_id equals its own id (categories_parent_not_self)', async () => {
        const row = await db.query(`INSERT INTO categories (name, slug) VALUES ('Self Parent', 'self-parent') RETURNING id`);
        const id = row.rows[0].id;
        await expect(db.query(`UPDATE categories SET parent_id = $1 WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514', constraint: 'categories_parent_not_self' });
    });
    it('rejects a second primary image for the same product (product_images_one_primary_per_product_idx)', async () => {
        await db.query(`INSERT INTO product_images (product_id, storage_path, is_primary) VALUES ($1, 'a.jpg', true)`, [productId]);
        await expect(db.query(`INSERT INTO product_images (product_id, storage_path, is_primary) VALUES ($1, 'b.jpg', true)`, [productId])).rejects.toMatchObject({ code: '23505', constraint: 'product_images_one_primary_per_product_idx' });
    });
});
