/**
 * Labeled boolean toggle (checkbox-based, no custom switch graphics — the
 * design skill specifies checkboxes at 20x20px with a 28x28px tap area, no
 * decorative effects). Used for Active/Featured flags in the product and
 * category forms.
 */
export function ToggleField({
  label,
  id,
  checked,
  onChange,
  disabled,
  helpText,
}: {
  label: string;
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  helpText?: string;
}) {
  return (
    <div className="mb-lg flex items-center gap-sm py-xs">
      <input
        id={id}
        type="checkbox"
        className="h-5 w-5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="text-sm text-text-primary">
        {label}
        {helpText && <span className="ml-sm text-xs text-text-secondary">{helpText}</span>}
      </label>
    </div>
  );
}
