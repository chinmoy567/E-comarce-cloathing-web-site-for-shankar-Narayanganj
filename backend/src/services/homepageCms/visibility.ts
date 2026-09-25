import type { CmsStatus, DisplayStatus } from '../../types/homepageCms.js';

/**
 * Shared server-evaluated scheduling (13-homepage-cms §13.7a, plan §3).
 * `now` must always come from the caller's own `new Date()` — no route ever
 * accepts a client-supplied "as of" timestamp, so a manipulated browser clock
 * cannot reveal scheduled content early or hide expired content late.
 *
 * Used identically for a Section and a Campaign; a Section additionally
 * requires its linked Campaign's own result to be visible (see
 * `homepage.service.ts`) — the "independent" scheduling language in §13.4 is
 * read here as "each has its own window," not "a section outlives its ended
 * campaign."
 */
export type VisibilityInput = {
  status: CmsStatus;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type VisibilityResult = {
  visible: boolean;
  displayStatus: DisplayStatus;
};

export function computeVisibility(entity: VisibilityInput, now: Date): VisibilityResult {
  if (entity.status === 'DRAFT') return { visible: false, displayStatus: 'DRAFT' };
  // DISABLED overrides an in-schedule window (§13.7a) — checked before the
  // schedule so a manually disabled but otherwise-live campaign never leaks.
  if (entity.status === 'DISABLED') return { visible: false, displayStatus: 'DISABLED' };
  if (entity.startsAt && entity.startsAt.getTime() > now.getTime()) {
    return { visible: false, displayStatus: 'SCHEDULED' };
  }
  if (entity.endsAt && entity.endsAt.getTime() < now.getTime()) {
    return { visible: false, displayStatus: 'EXPIRED' };
  }
  return { visible: true, displayStatus: 'ACTIVE' };
}
