import type { RiskLevel } from '@/lib/admin/types';
import { RISK_COLORS, RISK_LABELS } from '@/lib/admin/riskCheckView';

/**
 * Risk level indicator (PRD 09 §7.7). The palette colour is applied only to a 4px
 * start border and a glyph; the label is dark text on white so contrast never depends on the
 * amber. Glyph + label means colour is never the only signal.
 */
function Glyph({ level }: { level: RiskLevel }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (level) {
    case 'LOW':
      return <svg {...common}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
    case 'MEDIUM':
      return <svg {...common}><path d="M8 3v6M8 12v.5" /></svg>;
    case 'HIGH':
      return <svg {...common}><path d="M8 2.5l6 10.5H2L8 2.5z" /><path d="M8 7v3M8 11.8v.2" /></svg>;
    case 'CHECK_FAILED':
      return <svg {...common}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
    default:
      return <svg {...common}><path d="M6 6.2a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6M8 12v.2" /></svg>;
  }
}

export function RiskLevelBadge({ riskLevel }: { riskLevel: RiskLevel }) {
  const color = RISK_COLORS[riskLevel];
  return (
    <span
      role="img"
      aria-label={`Risk level: ${RISK_LABELS[riskLevel]}`}
      className="inline-flex items-center gap-2 border-l-4 bg-white py-xs pl-sm pr-md text-sm font-bold text-[#111827]"
      style={{ borderLeftColor: color }}
    >
      <span style={{ color }}>
        <Glyph level={riskLevel} />
      </span>
      {RISK_LABELS[riskLevel]}
    </span>
  );
}
