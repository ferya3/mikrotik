'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  /** CSS colour, e.g. var(--series-1). */
  color: string;
}

export interface TimePoint {
  t: number;
  [key: string]: number | null;
}

const H = 200;
const PAD = { top: 12, right: 64, bottom: 22, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Minimal line chart: one y-axis, 2px lines, recessive grid, legend + end-of-line direct labels,
 * crosshair tooltip on hover and a table view for accessibility.
 */
export function TimeChart({
  title,
  data,
  series,
  format,
  yMax,
}: {
  title: string;
  data: TimePoint[];
  series: Series[];
  format: (v: number) => string;
  yMax?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  // Draw in real pixels (viewBox = element size) so text and strokes are never stretched.
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, max, t0, t1 } = useMemo(() => {
    const t0 = data[0]?.t ?? 0;
    const t1 = data[data.length - 1]?.t ?? 1;
    const peak = Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)));
    const max = yMax ?? niceMax(peak);
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
    return { x, y, max, t0, t1 };
  }, [data, series, yMax, W]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!data.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(x(data[i].t) - px) < Math.abs(x(data[best].t) - px)) best = i;
    setHover(best);
  };

  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const hp = hover !== null ? data[hover] : null;
  const last = data[data.length - 1];

  return (
    <figure className="space-y-2" ref={boxRef}>
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          <button className="underline-offset-2 hover:underline" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
      </figcaption>

      {data.length < 2 ? (
        <div className="flex h-[200px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Collecting samples…
        </div>
      ) : showTable ? (
        <div className="max-h-[200px] overflow-y-auto text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className="text-left font-medium">Time</th>
                {series.map((s) => (
                  <th key={s.key} className="text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.t}>
                  <td>{new Date(d.t).toLocaleTimeString()}</td>
                  {series.map((s) => (
                    <td key={s.key} className="text-right tabular-nums">
                      {d[s.key] === null ? '—' : format(d[s.key]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={title}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="hsl(var(--chart-grid))" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {format(max * f)}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={H - 6} className="fill-muted-foreground text-[10px]">
              {time(t0)}
            </text>
            <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {time(t1)}
            </text>
            {series.map((s) => {
              const pts = data.filter((d) => d[s.key] !== null).map((d) => `${x(d.t)},${y(d[s.key]!)}`);
              return (
                <polyline
                  key={s.key}
                  points={pts.join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
            {/* Direct labels at the line ends */}
            {last &&
              series.map((s) =>
                last[s.key] === null ? null : (
                  <text key={s.key} x={W - PAD.right + 6} y={y(last[s.key]!) + 3} className="fill-foreground text-[10px]">
                    {s.label}
                  </text>
                ),
              )}
            {hp && (
              <g>
                <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" />
                {series.map((s) =>
                  hp[s.key] === null ? null : (
                    <circle key={s.key} cx={x(hp.t)} cy={y(hp[s.key]!)} r={4} fill={s.color} stroke="hsl(var(--card))" strokeWidth={2} />
                  ),
                )}
              </g>
            )}
          </svg>
          {hp && (
            <div
              className="pointer-events-none absolute top-1 rounded-md border bg-card px-2 py-1.5 text-xs shadow-md"
              style={{ left: `${(x(hp.t) / W) * 100}%`, transform: x(hp.t) > W / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}
            >
              <div className="mb-1 text-muted-foreground">{new Date(hp.t).toLocaleTimeString()}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums">{hp[s.key] === null ? '—' : format(hp[s.key]!)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
