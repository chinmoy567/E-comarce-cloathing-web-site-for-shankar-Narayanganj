/**
 * In-memory stand-in for the Supabase Storage client, so storage suites run without live
 * credentials. Use it from a test file as:
 *
 *   vi.mock('../../src/lib/supabase.ts', async () => (await import('../helpers/fakeSupabaseStorage.ts')).fakeSupabaseModule());
 *   import { fakeStore } from '../helpers/fakeSupabaseStorage.ts';
 *
 * `fakeStore` is the single shared state both the mocked client and the test read.
 */
export type FakeBucket = { public: boolean; objects: Map<string, { data: Buffer; contentType: string }> };

export const fakeStore = {
  buckets: new Map<string, FakeBucket>(),
  /** Report every existing bucket as public, whatever it was created as. */
  forcePublic: false,
  removeFails: false,
  signedTtls: [] as number[],
  reset(): void {
    this.buckets.clear();
    this.forcePublic = false;
    this.removeFails = false;
    this.signedTtls.length = 0;
  },
};

export function fakeSupabaseModule() {
  const client = {
    storage: {
      getBucket: async (name: string) => {
        const b = fakeStore.buckets.get(name);
        return b
          ? { data: { name, public: fakeStore.forcePublic || b.public }, error: null }
          : { data: null, error: { message: 'not found' } };
      },
      createBucket: async (name: string, opts: { public: boolean }) => {
        fakeStore.buckets.set(name, { public: opts.public, objects: new Map() });
        return { data: { name }, error: null };
      },
      from: (name: string) => ({
        upload: async (path: string, data: Buffer, opts: { contentType: string }) => {
          fakeStore.buckets.get(name)!.objects.set(path, { data, contentType: opts.contentType });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          if (fakeStore.removeFails) return { data: null, error: { message: 'boom' } };
          for (const p of paths) fakeStore.buckets.get(name)!.objects.delete(p);
          return { data: [], error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/public/${name}/${path}` } }),
        createSignedUrl: async (path: string, ttl: number) => {
          fakeStore.signedTtls.push(ttl);
          return { data: { signedUrl: `https://storage.test/sign/${name}/${path}?token=t` }, error: null };
        },
      }),
    },
  };
  return { resetSupabaseClient: () => undefined, getSupabase: () => client };
}
