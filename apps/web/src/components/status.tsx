import { Badge } from '@/components/ui/badge';
import type { RouterStatus } from '@/lib/types';

const MAP: Record<RouterStatus, { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' }> = {
  ONLINE: { label: 'Online', variant: 'success' },
  OFFLINE: { label: 'Offline', variant: 'destructive' },
  AUTH_FAILED: { label: 'Auth failed', variant: 'warning' },
  UNKNOWN: { label: 'Unknown', variant: 'secondary' },
};

export function StatusBadge({ status }: { status: RouterStatus }) {
  const s = MAP[status];
  return (
    <Badge variant={s.variant}>
      <span className="size-1.5 rounded-full bg-current" />
      {s.label}
    </Badge>
  );
}

export function Meter({ value, warn = 70, crit = 90 }: { value: number | undefined | null; warn?: number; crit?: number }) {
  if (value === undefined || value === null) return <span className="text-muted-foreground">—</span>;
  const color = value >= crit ? 'bg-destructive' : value >= warn ? 'bg-warning' : 'bg-success';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="w-9 text-right tabular-nums">{value}%</span>
    </div>
  );
}
