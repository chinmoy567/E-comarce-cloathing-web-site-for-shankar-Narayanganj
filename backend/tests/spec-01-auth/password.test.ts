import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword, verifyPassword } from '../../src/lib/password.ts';
import { BCRYPT_COST } from '../../src/config/constants.ts';

/**
 * Spec 02 — password hashing (11-security-hardening §11.7, 02-customer §2.1).
 *
 * Two separate claims are under test. The first is behavioural: a hash verifies
 * its own plaintext and nothing else. The second is structural — that this is
 * the *only* place hashing happens — which no behavioural test can establish,
 * so it is checked by scanning the source tree for a second bcrypt import.
 */
describe('hashPassword', () => {
  it('never returns the plaintext', async () => {
    const hash = await hashPassword('Str0ng-Passw0rd!');

    expect(hash).not.toContain('Str0ng-Passw0rd!');
  });

  it('produces a bcrypt hash at the configured cost (§11.7)', async () => {
    const hash = await hashPassword('Str0ng-Passw0rd!');

    // $2b$<cost>$<salt+digest> — the cost is the parameter §11.7 cares about.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(Number(hash.split('$')[2])).toBe(BCRYPT_COST);
  });

  it('uses a cost of at least 12', () => {
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });

  it('salts: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(a).not.toBe(b);
    // Both still verify — different salt, same password.
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('handles unicode and long passphrases', async () => {
    const passphrase = 'পাসওয়ার্ড-১২৩ ünïcode';
    const hash = await hashPassword(passphrase);

    expect(await verifyPassword(passphrase, hash)).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse');

    expect(await verifyPassword('correct-horse', hash)).toBe(true);
    expect(await verifyPassword('Correct-horse', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false rather than throwing on a corrupt or empty stored hash', async () => {
    // A corrupt row must read as "wrong password", not as a 500 that tells an
    // attacker this account differs from every other.
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
    expect(await verifyPassword('anything', '$2b$12$tooshort')).toBe(false);
  });
});

describe('hashing is centralized (§11.7)', () => {
  /** Every .ts file under backend/src. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('no module outside lib/password.ts imports bcrypt or argon2', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      .filter((file) => !file.endsWith(join('lib', 'password.ts')))
      .filter((file) => /from\s+['"](bcrypt|bcryptjs|argon2)['"]/.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('no source module logs a password field', () => {
    // Guards §5.12.1 items 6-8: a plaintext password must never reach a log.
    const offenders = sourceFiles(join(process.cwd(), 'src')).filter((file) =>
      /log(ger)?\.\w+\([^)]*\b(password|plaintext)\b/i.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
