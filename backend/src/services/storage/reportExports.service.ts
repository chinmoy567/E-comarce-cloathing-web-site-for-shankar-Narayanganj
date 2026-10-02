import { getSupabase } from '../../lib/supabase.js';
import { getEnv } from '../../config/env.js';
import { REPORT_EXPORT_BUCKET } from '../../config/constants.js';
import { InternalError } from '../../lib/errors.js';

/**
 * Private storage for report CSVs (spec 20, 11-security-hardening §11.4). The bucket is created
 * PRIVATE; a file is released only through a short-lived signed URL minted for the owning admin
 * (the route checks ownership first). Nothing here returns a public URL.
 */

let bucketReady = false;

async function ensurePrivateBucket(): Promise<void> {
  if (bucketReady) return;
  const storage = getSupabase().storage;
  const existing = await storage.getBucket(REPORT_EXPORT_BUCKET);
  if (existing.error || !existing.data) {
    const created = await storage.createBucket(REPORT_EXPORT_BUCKET, { public: false });
    // Another worker may have created it between the two calls.
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new InternalError('Failed to prepare the export bucket.');
    }
  } else if (existing.data.public) {
    throw new InternalError('The export bucket must be private.');
  }
  bucketReady = true;
}

export async function uploadExportCsv(path: string, csv: string): Promise<void> {
  await ensurePrivateBucket();
  const { error } = await getSupabase()
    .storage.from(REPORT_EXPORT_BUCKET)
    .upload(path, Buffer.from(csv, 'utf-8'), { contentType: 'text/csv; charset=utf-8', upsert: true });
  if (error) throw new InternalError('Failed to store the export file.');
}

export async function signExportUrl(path: string): Promise<{ url: string; expiresAt: Date }> {
  const ttl = getEnv().REPORT_EXPORT_URL_TTL_SEC;
  const { data, error } = await getSupabase().storage.from(REPORT_EXPORT_BUCKET).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) throw new InternalError('Failed to create the download link.');
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttl * 1000) };
}

/** Test seam. */
export function resetExportBucketCache(): void {
  bucketReady = false;
}
