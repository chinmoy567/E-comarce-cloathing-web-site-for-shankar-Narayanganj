import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedGeography } from '../scripts/seedGeography.ts';
import { dropSchema, resetSchema, scopedUrl, TEST_DATABASE_URL } from '../helpers/schemaFixture.ts';
import { applyTestEnv } from '../helpers/testEnv.ts';
/**
 * The geography endpoints end to end (task §6, §11, §18).
 *
 * Asserts what the frontend actually depends on: a progressive, dependent
 * selection where each step is validated server-side, and where an invalid or
 * mismatched id is rejected by the API rather than by a dropdown.
 */
const SCHEMA = 'geography_api_test';
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
describeDb('geography API', () => {
    let app;
    const originalUrl = process.env.DATABASE_URL;
    beforeAll(async () => {
        await resetSchema(SCHEMA);
        await seedGeography(scopedUrl(SCHEMA));
        applyTestEnv();
        // The app's repositories connect through DATABASE_URL, so point them at
        // this suite's schema before the env module is first read.
        process.env.DATABASE_URL = scopedUrl(SCHEMA);
        const { createApp } = await import('../../src/app.js');
        app = createApp();
    });
    afterAll(async () => {
        if (originalUrl === undefined)
            delete process.env.DATABASE_URL;
        else
            process.env.DATABASE_URL = originalUrl;
        await dropSchema(SCHEMA);
    });
    it('GET /api/geography/divisions returns the 8 divisions', async () => {
        const res = await request(app).get('/api/geography/divisions').expect(200);
        expect(res.body.data).toHaveLength(8);
        expect(res.body.data[0]).toHaveProperty('pcode');
        // No internal columns leak into the public payload.
        expect(res.body.data[0]).not.toHaveProperty('created_at');
        expect(res.body.data[0]).not.toHaveProperty('division_id');
    });
    it('walks Division -> District -> Upazila, each scoped to its parent', async () => {
        const divisions = await request(app).get('/api/geography/divisions').expect(200);
        const chattogram = divisions.body.data.find((d) => d.name === 'Chattogram');
        const districts = await request(app)
            .get(`/api/geography/divisions/${chattogram.id}/districts`)
            .expect(200);
        const names = districts.body.data.map((d) => d.name);
        expect(names).toContain('Cumilla');
        expect(names).not.toContain('Dhaka');
        const cumilla = districts.body.data.find((d) => d.name === 'Cumilla');
        const upazilas = await request(app)
            .get(`/api/geography/districts/${cumilla.id}/upazilas`)
            .expect(200);
        expect(upazilas.body.data.map((u) => u.name)).toContain('Daudkandi');
    });
    it('rejects a non-uuid id with 400 rather than reaching the database', async () => {
        const res = await request(app).get('/api/geography/divisions/not-a-uuid/districts').expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details[0].field).toBe('id');
    });
    it('returns 404 for a well-formed but unknown id', async () => {
        const unknown = '00000000-0000-4000-8000-000000000000';
        // 404, not an empty 200: an invalid id must never look like a real division
        // that happens to have no districts.
        await request(app).get(`/api/geography/divisions/${unknown}/districts`).expect(404);
        await request(app).get(`/api/geography/districts/${unknown}/upazilas`).expect(404);
    });
    it('exposes no mutation endpoints for the seeded dataset', async () => {
        const divisions = await request(app).get('/api/geography/divisions').expect(200);
        const id = divisions.body.data[0].id;
        // Reference data is seeded, not administered (task §15) — a CRUD surface
        // nobody asked for is a liability, so none exists.
        await request(app).post('/api/geography/divisions').send({ name: 'Fake' }).expect(404);
        await request(app).patch(`/api/geography/divisions/${id}`).send({ name: 'Renamed' }).expect(404);
        await request(app).delete(`/api/geography/divisions/${id}`).expect(404);
    });
});
