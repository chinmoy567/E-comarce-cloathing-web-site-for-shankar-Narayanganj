import type { CmsDisplayStatus } from '@/lib/admin/types';

const STYLE: Record<CmsDisplayStatus, string> = {
  ACTIVE: 'bg-accent/10 text-accent',
  DRAFT: 'bg-text-tertiary/10 text-text-secondary',
  SCHEDULED: 'bg-primary/10 text-primary',
  DISABLED: 'bg-text-tertiary/10 text-text-secondary',
  EXPIRED: 'bg-error/10 text-error',
};

const LABEL: Record<CmsDisplayStatus, string> = {
  ACTIVE: 'Active',
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  DISABLED: 'Disabled',
  EXPIRED: 'Expired',
};

/** The backend's computed `displayStatus` as text plus a tone — never derived from dates in the browser (§13.7a). */
export function DisplayStatusBadge({ status }: { status: CmsDisplayStatus }) {
  return <span className={`rounded-lg px-sm py-xs text-xs font-semibold ${STYLE[status]}`}>{LABEL[status]}</span>;
}
