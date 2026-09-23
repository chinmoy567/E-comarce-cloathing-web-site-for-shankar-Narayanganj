import express, { type RequestHandler } from 'express';

/**
 * Produces a body parser bounded to `maxBytes`, for upload routes only
 * (spec 04 §Body limits). The global `express.json({limit:'100kb'})` in
 * `app.ts` stays the default for every other route; a route accepting a
 * multipart/binary upload mounts this instead, scoped to just that route.
 */
export function createUploadLimit(maxBytes: number): RequestHandler {
  return express.raw({ limit: maxBytes, type: () => true });
}
