'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { Meter, StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get } from '@/lib/api';
import type { Alert, Overview } from '@/lib/types';
import { formatBps, formatBytes, timeAgo } from '@/lib/utils';

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'success' | 'destructive' | 'warning' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  // Initial snapshot over HTTP; afterwards the WebSocket keeps this cache current.
  const { data, error } = useQuery({ queryKey: ['overview'], queryFn: () => get<Overview>('/monitoring/overview') });
  const alerts = useQuery({ queryKey: ['alerts', 'OPEN'], queryFn: () => get<Alert[]>('/alerts?state=OPEN') });

  const t = data?.totals;
  return (
    <>
      <PageHeader title="Network overview" description="Live state of every managed router — updates in real time." />
      {error && <p className="mb-4 text-sm text-destructive">{(error as Error).message}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Routers" value={t?.routers ?? '—'} />
        <Stat label="Online" value={t?.online ?? '—'} tone="success" />
        <Stat label="Offline" value={t?.offline ?? '—'} tone={t?.offline ? 'destructive' : undefined} />
        <Stat label="Average CPU" value={t?.avgCpu !== null && t?.avgCpu !== undefined ? `${t.avgCpu}%` : '—'} />
        <Stat label="Open alerts" value={t?.openAlerts ?? '—'} tone={t?.openAlerts ? 'warning' : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Routers</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Router</TH>
                <TH>IP</TH>
                <TH>Status</TH>
                <TH>CPU</TH>
                <TH>Memory</TH>
                <TH className="text-right">Rx</TH>
                <TH className="text-right">Tx</TH>
                <TH className="text-right">PPP</TH>
                <TH>Uptime</TH>
              </TR>
            </THead>
            <TBody>
              {data?.routers.map((r) => {
                const l = r.live;
                const mem = l?.memTotal ? Math.round(((l.memUsed ?? 0) / l.memTotal) * 100) : undefined;
                return (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/routers/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      {r.group && <div className="text-xs text-muted-foreground">{r.group.name}</div>}
                    </TD>
                    <TD className="font-mono text-xs">{r.host}</TD>
                    <TD>
                      <StatusBadge status={r.status} />
                      {r.status !== 'ONLINE' && <div className="mt-0.5 text-xs text-muted-foreground">seen {timeAgo(r.lastSeenAt)}</div>}
                    </TD>
                    <TD>
                      <Meter value={l?.cpuLoad} />
                    </TD>
                    <TD title={l?.memTotal ? `${formatBytes(l.memUsed)} / ${formatBytes(l.memTotal)}` : undefined}>
                      <Meter value={mem} warn={80} crit={95} />
                    </TD>
                    <TD className="text-right tabular-nums">{formatBps(l?.rxBps)}</TD>
                    <TD className="text-right tabular-nums">{formatBps(l?.txBps)}</TD>
                    <TD className="text-right tabular-nums">{l?.pppActive ?? '—'}</TD>
                    <TD className="text-xs text-muted-foreground">{l?.uptime ?? '—'}</TD>
                  </TR>
                );
              })}
              {data && data.routers.length === 0 && (
                <TR>
                  <TD colSpan={9} className="py-8 text-center text-muted-foreground">
                    No routers yet — <Link href="/routers" className="underline">add one</Link>.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.data?.length === 0 && <p className="text-sm text-muted-foreground">All clear.</p>}
            {alerts.data?.slice(0, 10).map((a) => (
              <div key={a.id} className="rounded-md border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.message}</span>
                  <Badge variant={a.severity === 'CRITICAL' ? 'destructive' : a.severity === 'WARNING' ? 'warning' : 'secondary'}>
                    {a.severity.toLowerCase()}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {a.router?.name} · {timeAgo(a.createdAt)}
                </div>
              </div>
            ))}
            {!!alerts.data?.length && (
              <Link href="/alerts" className="block pt-1 text-xs text-muted-foreground hover:underline">
                All alerts →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
