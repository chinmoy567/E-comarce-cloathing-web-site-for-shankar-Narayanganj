import Link from 'next/link';
import type { HomepageSectionAdminResponse } from '@/lib/admin/types';
import { Button } from '@/components/admin/Button';
import { DisplayStatusBadge } from './DisplayStatusBadge';

export const SECTION_TYPE_LABEL: Record<string, string> = {
  HERO: 'Hero',
  CATEGORY_GRID: 'Category Grid',
  PRODUCT_CAROUSEL: 'Product Carousel',
  CAMPAIGN_BANNER: 'Campaign Banner',
  PROMO_BANNER: 'Promo Banner',
  CUSTOM_CONTENT: 'Custom Content',
};

const MOVE_BUTTON =
  'flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background disabled:cursor-not-allowed disabled:opacity-40';

/** One row of the Homepage Builder list (13-homepage-cms §13.12). Presentational — all requests are issued by the page. */
export function SectionRow({
  section,
  index,
  count,
  busy,
  onMove,
  onToggle,
  onDelete,
}: {
  section: HomepageSectionAdminResponse;
  index: number;
  count: number;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const name = section.title || SECTION_TYPE_LABEL[section.sectionType] || section.sectionType;
  const toggleLabel = section.status === 'DRAFT' ? 'Publish' : section.status === 'DISABLED' ? 'Enable' : 'Disable';

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-border bg-background p-lg md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-semibold text-text-primary">
          {index + 1}. {name}
        </p>
        <p className="text-xs text-text-secondary">{SECTION_TYPE_LABEL[section.sectionType]}</p>
      </div>

      <div className="flex flex-wrap items-center gap-sm">
        <DisplayStatusBadge status={section.displayStatus} />

        <button type="button" aria-label={`Move ${name} up`} disabled={busy || index === 0} onClick={() => onMove(-1)} className={MOVE_BUTTON}>
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${name} down`}
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
          className={MOVE_BUTTON}
        >
          ↓
        </button>

        <Link href={`/admin/content/homepage/${section.id}`} aria-label={`Edit ${name}`}>
          <Button type="button" variant="secondary" disabled={busy}>
            Edit
          </Button>
        </Link>
        <Button type="button" variant="secondary" disabled={busy} onClick={onToggle} aria-label={`${toggleLabel} ${name}`}>
          {toggleLabel}
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={onDelete} aria-label={`Delete ${name}`}>
          Delete
        </Button>
      </div>
    </li>
  );
}
