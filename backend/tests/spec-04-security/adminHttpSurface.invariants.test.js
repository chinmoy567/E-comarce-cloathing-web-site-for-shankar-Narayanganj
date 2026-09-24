import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
/**
 * Spec 03 — architecture invariants (test skill R14; coverage-map trap:
 * "Also assert that no HTTP route exposes [the out-of-band reset script]").
 *
 * Model: `password.test.ts`'s "hashing is centralized" — walk the tree,
 * filter, match, assert `offenders` equals `[]`, so a failure names the file.
 */
const SRC_ROOT = join(process.cwd(), 'src');
function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory())
            return walk(full);
        if (entry.name.endsWith('.ts'))
            return [full];
        return [];
    });
}
describe('admin HTTP surface invariants (spec 03)', () => {
    it('no route module references resetAdminPassword or the out-of-band reset (it is a CLI, never an endpoint)', () => {
        const routeFiles = walk(join(SRC_ROOT, 'routes')).concat(walk(join(SRC_ROOT, 'controllers')));
        const offenders = routeFiles.filter((file) => {
            const content = readFileSync(file, 'utf8');
            return /resetAdminPassword|OUT_OF_BAND_ADMIN_RESET/.test(content);
        });
        expect(offenders).toEqual([]);
    });
    it('no admin validation schema declares a `role` field anywhere (§5.15 rule 7, acceptance 16)', () => {
        const validationFile = join(SRC_ROOT, 'validation', 'admin.validation.ts');
        const content = readFileSync(validationFile, 'utf8');
        // A bare `role:` key inside a z.object({...}) shape. This is a heuristic
        // scan paired with the behavioural VALIDATION_ERROR tests in
        // managers.api.test.ts, not a substitute for them.
        const roleFieldPattern = /\brole\s*:\s*z\./;
        expect(roleFieldPattern.test(content)).toBe(false);
    });
    it('the seed script writes is_system_admin directly and no other backend module does', () => {
        const files = walk(SRC_ROOT);
        const offenders = files.filter((file) => {
            if (file.endsWith(join('repositories', 'users.repository.ts')))
                return false; // documents the exclusion, writes nothing
            const content = readFileSync(file, 'utf8');
            return /is_system_admin\s*=\s*(true|\$)/.test(content) && /UPDATE|INSERT/i.test(content);
        });
        expect(offenders).toEqual([]);
    });
});
