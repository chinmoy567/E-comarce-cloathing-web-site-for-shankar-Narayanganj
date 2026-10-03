import { pathaoAdapter } from './adapters/pathao.adapter.js';
import { registerAdapter } from './registry.js';

/** Registers every real courier adapter. Called once by each process entry point (server, scripts). */
export function registerCourierAdapters(): void {
  registerAdapter(pathaoAdapter);
}
