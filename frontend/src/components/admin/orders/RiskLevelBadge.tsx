interface RiskLevelBadgeProps {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'CHECK_FAILED';
  riskScore?: number | null;
}

export function RiskLevelBadge({ riskLevel, riskScore }: RiskLevelBadgeProps) {
  const colorClasses: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800',
    MEDIUM: 'bg-yellow-100 text-yellow-800',
    HIGH: 'bg-red-100 text-red-800',
    UNKNOWN: 'bg-gray-100 text-gray-800',
    CHECK_FAILED: 'bg-gray-100 text-gray-800',
  };

  const labels: Record<string, string> = {
    LOW: 'LOW RISK',
    MEDIUM: 'MEDIUM RISK',
    HIGH: 'HIGH RISK',
    UNKNOWN: 'UNKNOWN',
    CHECK_FAILED: 'CHECK FAILED',
  };

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg px-md py-xs font-semibold text-sm ${colorClasses[riskLevel]}`}>
      <span>{labels[riskLevel]}</span>
      {riskScore !== null && riskScore !== undefined && (
        <span className="text-xs opacity-75">Score: {riskScore}</span>
      )}
    </div>
  );
}
