import type { HomepageSectionResponse } from '@/lib/publicTypes';

/**
 * CUSTOM_CONTENT section (13-homepage-cms §13.3, §13.13, plan §6). `body` was
 * already sanitized server-side (§13.13's allowlist) before storage — this
 * still renders it via `dangerouslySetInnerHTML` only on that already-
 * sanitized value, never on raw user input.
 */
export function CustomContentBlock({ section }: { section: HomepageSectionResponse }) {
  const config = section.contentConfig as { body?: string } | null;
  const body = config?.body;
  if (!body) return null;

  return (
    <section className="prose prose-sm max-w-none rounded-lg border border-border bg-background p-lg">
      {section.title && <h2 className="text-xl font-semibold md:text-[28px]">{section.title}</h2>}
      {/* eslint-disable-next-line react/no-danger -- body is sanitized server-side before storage (§13.13) */}
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </section>
  );
}
