'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/account';
import { CHART, formatReportDate, labelIndexes, plotPoints, TREND_MEASURES, type TrendMeasure } from '@/lib/admin/reportsView';
import type { TrendPoint } from '@/lib/admin/reports';

const SERIES = '#1F2937';
const GRID = '#E5E7EB';

/**
 * One-series line chart in plain SVG (no charting dependency, no dual axis, no gradient or motion).
 * Points are focusable and tap/click to pin; the pinned value is also printed as text. The table
 * equivalent is rendered directly beneath by the page, so colour is never the only carrier of meaning.
 */
export function TrendChart({ points, measure }: { points: TrendPoint[]; measure: TrendMeasure }) {
  const [pinned, setPinned] = useState<number | null>(null);
  const meta = TREND_MEASURES.find((m) => m.key === measure)!;
  const fmt = (v: number) => (meta.money ? formatMoney(v, { decimals: 2 }) : v.toLocaleString('en-BD'));

  const items = points.map((p) => ({ label: formatReportDate(p.day), value: p[measure] }));
  const { points: plot, ticks } = plotPoints(items);
  const labels = new Set(labelIndexes(plot.length));
  const baseline = CHART.height - CHART.padBottom;
  const line = plot.map((p) => `${p.x},${p.y}`).join(' ');
  const active = pinned !== null ? plot[pinned] : undefined;

  const summary = `${meta.label}, ${items[0]?.label ?? ''} to ${items[items.length - 1]?.label ?? ''}, ${items.length} points`;

  return (
    <figure className="mb-lg">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={summary}
        className="h-auto w-full"
        style={{ aspectRatio: `${CHART.width} / ${CHART.height}` }}
      >
        {ticks.map((t) => {
          const y = CHART.padTop + (CHART.height - CHART.padTop - CHART.padBottom) * (1 - t / ticks[2]!);
          return (
            <g key={t}>
              <line x1={CHART.padLeft} x2={CHART.width - CHART.padRight} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={CHART.padLeft - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#6B7280">
                {meta.money ? formatMoney(Math.round(t)) : Math.round(t).toLocaleString('en-BD')}
              </text>
            </g>
          );
        })}
        <line x1={CHART.padLeft} x2={CHART.width - CHART.padRight} y1={baseline} y2={baseline} stroke={GRID} strokeWidth={1} />

        {plot.length > 1 && <polyline points={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />}

        {plot.map((p, i) => (
          <g key={p.label + i}>
            {labels.has(i) && (
              <text x={p.x} y={baseline + 18} textAnchor="middle" fontSize={11} fill="#6B7280">
                {p.label}
              </text>
            )}
            <circle cx={p.x} cy={p.y} r={pinned === i ? 6 : 4} fill={SERIES} />
            {/* Larger invisible hit target: focusable for keyboard, tap to pin on touch. */}
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${fmt(p.value)}`}
              onClick={() => setPinned(pinned === i ? null : i)}
              onFocus={() => setPinned(i)}
              onMouseEnter={() => setPinned(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPinned(pinned === i ? null : i);
                }
              }}
              className="cursor-pointer focus:outline-none focus-visible:stroke-primary"
              stroke="transparent"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      <figcaption className="mt-xs min-h-[1.5rem] text-sm" aria-live="polite">
        {active ? (
          <>
            <strong>{active.label}</strong>: {fmt(active.value)}
          </>
        ) : (
          <span className="text-text-secondary">Select a point to see its value.</span>
        )}
      </figcaption>
    </figure>
  );
}
