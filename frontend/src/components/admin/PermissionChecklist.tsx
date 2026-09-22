import type { PermissionCatalogueEntry } from '@/lib/admin/types';

/**
 * Grouped `ASSIGNED`-tier permission checklist (spec 03 §Frontend work): only
 * ASSIGNED-tier keys are shown — `YES`-tier is already held by role and
 * `NO`-tier can never be granted, matching the backend's `PERMISSION_NOT_ASSIGNABLE`
 * rejection (§5.13, §5.16). Grouped by the §5.17 operational/administrative
 * split. A key the current Admin does not itself hold renders disabled with
 * the reason, matching the backend's `CANNOT_GRANT_UNHELD_PERMISSION`
 * rejection (§5.15 rule 6) instead of letting the user discover it on submit.
 */
export function PermissionChecklist({
  catalogue,
  actorPermissions,
  selected,
  onChange,
}: {
  catalogue: PermissionCatalogueEntry[];
  /** The current actor's own effective permissions — the ceiling it may grant. */
  actorPermissions: Set<string>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const assignable = catalogue.filter((entry) => entry.managerTier === 'ASSIGNED');
  const operational = assignable.filter((entry) => !entry.isAdministrative);
  const administrative = assignable.filter((entry) => entry.isAdministrative);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  }

  function renderGroup(title: string, entries: PermissionCatalogueEntry[]) {
    if (entries.length === 0) return null;
    return (
      <fieldset className="mb-lg">
        <legend className="mb-sm text-sm font-bold text-text-primary">{title}</legend>
        <div className="flex flex-col gap-sm">
          {entries.map((entry) => {
            const held = actorPermissions.has(entry.key);
            return (
              <label
                key={entry.key}
                className={`flex items-center gap-sm py-xs ${held ? '' : 'opacity-50'}`}
                title={held ? undefined : 'You do not hold this permission, so you cannot grant it.'}
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={selected.has(entry.key)}
                  disabled={!held}
                  onChange={() => toggle(entry.key)}
                />
                <span className="text-sm text-text-primary">{entry.label}</span>
                {!held && <span className="text-xs text-text-secondary">(you don&apos;t hold this)</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      {renderGroup('Operational Permissions', operational)}
      {renderGroup('Administrative Permissions', administrative)}
    </div>
  );
}
