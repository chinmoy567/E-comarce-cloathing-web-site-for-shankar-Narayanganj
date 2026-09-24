import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
/**
 * Spec 04 §11.4 — pagination is mandatory on every list endpoint (test
 * required 13, acceptance 15). Model: `password.test.ts`'s "hashing is
 * centralized" / `adminHttpSurface.invariants.test.ts` — walk the tree,
 * filter, match, assert `offenders` equals `[]`.
 *
 * A route-table introspection (mounting the real app and enumerating
 * `app._router.stack`) cannot distinguish "returns a bounded array" from
 * "returns an unbounded array" without also knowing the controller's
 * response shape, so this is a static scan over `src/controllers/*.ts`
 * instead: every controller whose handler builds a JSON body containing a
 * `data: [...]`-shaped array from a repository/service list call must also
 * include a `pagination:` block built by `buildPagination()`.
 *
 * Exemption: a small, fixed reference catalogue with no per-request growth
 * (permission catalogue: 47 fixed rows; geography divisions/districts/
 * upazilas: Bangladesh's published administrative list, bounded at load
 * time and never user-generated) is not "a list endpoint" in the §11.4 sense
 * — nothing about client input or accumulated data can make these grow
 * without bound. They are named explicitly below rather than silently
 * excluded by the scan, so adding a new one requires a deliberate edit here.
 */
const SRC_ROOT = join(process.cwd(), 'src');
const CONTROLLERS_DIR = join(SRC_ROOT, 'controllers');
/** Controllers whose `data: [...]` array is a small, fixed reference dataset, not a growing business list. */
const REFERENCE_CATALOGUE_EXEMPTIONS = new Set([
    'geography.controller.ts', // divisions/districts/upazilas — bounded, seeded, non-growing
    'permissionsCatalogue.controller.ts', // the fixed 47-row permission catalogue
]);
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
/** A controller function body returns `data: someArrayIshExpression` — heuristic: `data:` followed eventually by `.map(` or an array literal, inside a `res.status(200).json({...})` call. */
function declaresArrayData(content) {
    // `data: items.map(...)` or `data: someArray` where the surrounding json() call
    // is a list response (has a `res.status(200).json({` immediately containing `data:`).
    return /res\.(status\(200\)\.)?json\(\{\s*[\s\S]{0,80}?data:\s*[a-zA-Z_$][\w$]*\.map\(/.test(content);
}
function declaresPaginationBlock(content) {
    return /pagination:\s*buildPagination\(/.test(content);
}
describe('pagination registry (spec 04 §11.4, test 13, acceptance 15)', () => {
    it('every controller that maps a repository/service result into a data array also attaches a buildPagination() block, unless explicitly exempted as a fixed reference catalogue', () => {
        const controllerFiles = walk(CONTROLLERS_DIR);
        const offenders = controllerFiles.filter((file) => {
            const filename = file.split(/[/\\]/).pop();
            if (REFERENCE_CATALOGUE_EXEMPTIONS.has(filename))
                return false;
            const content = readFileSync(file, 'utf8');
            if (!declaresArrayData(content))
                return false;
            return !declaresPaginationBlock(content);
        });
        expect(offenders).toEqual([]);
    });
    it('the exemption list contains only controllers that genuinely declare no pagination block, so the exemption is not silently hiding a real gap', () => {
        const missingPagination = [...REFERENCE_CATALOGUE_EXEMPTIONS].filter((filename) => {
            const file = walk(CONTROLLERS_DIR).find((f) => f.endsWith(filename));
            if (!file)
                throw new Error(`Exempted controller ${filename} does not exist — remove it from the exemption list.`);
            const content = readFileSync(file, 'utf8');
            return !declaresPaginationBlock(content);
        });
        expect(missingPagination).toEqual([...REFERENCE_CATALOGUE_EXEMPTIONS]);
    });
    it('every controller with a pagination block uses the shared buildPagination() helper, never a hand-rolled shape', () => {
        const controllerFiles = walk(CONTROLLERS_DIR);
        const offenders = controllerFiles.filter((file) => {
            const content = readFileSync(file, 'utf8');
            const hasPaginationKey = /\bpagination:\s*\{/.test(content);
            const usesHelper = /pagination:\s*buildPagination\(/.test(content);
            return hasPaginationKey && !usesHelper;
        });
        expect(offenders).toEqual([]);
    });
});
