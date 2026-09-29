/** Neutral status pill; colour only hints at outcome, the label carries the meaning. */
const TONES = {
  good: 'bg-success/10 text-accent',
  bad: 'bg-error/10 text-error',
  neutral: 'border border-border bg-surface text-text-secondary',
} as const;

type Tone = keyof typeof TONES;

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={`inline-block rounded-full px-md py-xs text-xs font-semibold ${TONES[tone]}`}>{label}</span>;
}

export function toneFor(value: string): Tone {
  if (['DELIVERED', 'PAID_VERIFIED', 'PAID_COLLECTED', 'CONFIRMED'].includes(value)) return 'good';
  if (['CANCELLED', 'REJECTED', 'RETURNED', 'CREATION_FAILED', 'DELIVERY_FAILED'].includes(value)) return 'bad';
  return 'neutral';
}
