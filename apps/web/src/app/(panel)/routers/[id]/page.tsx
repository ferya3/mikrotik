'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power, RefreshCw, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { ResourceTab } from '@/components/resource-tab';
import { Meter, StatusBadge } from '@/components/status';
import { TimeChart, TimePoint } from '@/components/time-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { del, get, patch, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { RESOURCE_DEFS } from '@/lib/resources';
import type { RouterLive, RouterRow } from '@/lib/types';
import { formatBps, formatBytes } from '@/lib/utils';
import { RouterForm } from '../router-form';
import { BackupsTab } from './backups-tab';
import { LogsTab } from './logs-tab';

type TabKey =
  | 'overview'
  | 'interfaces'
  | 'ip'
  | 'firewall'
  | 'nat'
  | 'address-lists'
  | 'dhcp'
  | 'ppp'
  | 'queues'
  | 'logs'
  | 'backups';

const TABS: { value: TabKey; label: string; perm: string }[] = [
  { value: 'overview', label: 'Overview', perm: 'router:read' },
  { value: 'interfaces', label: 'Interfaces', perm: 'interface:read' },
  { value: 'ip', label: 'IP & Routes', perm: 'ip:read' },
  { value: 'firewall', label: 'Firewall', perm: 'firewall:read' },
  { value: 'nat', label: 'NAT', perm: 'firewall:read' },
  { value: 'address-lists', label: 'Address Lists', perm: 'firewall:read' },
  { value: 'dhcp', label: 'DHCP', perm: 'dhcp:read' },
  { value: 'ppp', label: 'PPP', perm: 'ppp:read' },
  { value: 'queues', label: 'Queues', perm: 'queue:read' },
  { value: 'logs', label: 'Logs', perm: 'log:read' },
  { value: 'backups', label: 'Backups', perm: 'backup:read' },
];

interface HistoryRow {
  t: string;
  cpu: number | null;
  rxBps: number | null;
  txBps: number | null;
}

function Overview({ router }: { router: RouterRow }) {
  const can = useCan();
  const live = useQuery({
    queryKey: ['live', router.id],
    queryFn: () => get<RouterLive | null>(`/monitoring/routers/${router.id}/live`),
    enabled: can('monitoring:read'),
  });
  const history = useQuery({
    queryKey: ['history', router.id],
    queryFn: () => get<HistoryRow[]>(`/monitoring/routers/${router.id}/history?hours=1`),
    enabled: can('monitoring:read'),
  });

  // Append each live snapshot to the local history so charts move in real time.
  const [points, setPoints] = useState<TimePoint[]>([]);
  useEffect(() => {
    if (history.data) {
      setPoints(history.data.map((h) => ({ t: new Date(h.t).getTime(), rx: h.rxBps, tx: h.txBps, cpu: h.cpu })));
    }
  }, [history.data]);
  const l = live.data;
  useEffect(() => {
    if (!l || l.status !== 'ONLINE') return;
    setPoints((p) =>
      p.length && p[p.length - 1].t >= l.ts
        ? p
        : [...p.filter((x) => x.t > l.ts - 3600_000), { t: l.ts, rx: l.rxBps ?? null, tx: l.txBps ?? null, cpu: l.cpuLoad ?? null }],
    );
  }, [l]);

  const mem = l?.memTotal ? Math.round(((l.memUsed ?? 0) / l.memTotal) * 100) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Identity</dt>
              <dd>{router.identity ?? '—'}</dd>
              <dt className="text-muted-foreground">Board</dt>
              <dd>{router.boardName ?? '—'}</dd>
              <dt className="text-muted-foreground">RouterOS</dt>
              <dd>{router.version ?? '—'}</dd>
              <dt className="text-muted-foreground">Architecture</dt>
              <dd>{router.architecture ?? '—'}</dd>
              <dt className="text-muted-foreground">Serial</dt>
              <dd className="font-mono text-xs">{router.serialNumber ?? '—'}</dd>
              <dt className="text-muted-foreground">Uptime</dt>
              <dd>{l?.uptime ?? '—'}</dd>
              <dt className="text-muted-foreground">Transport</dt>
              <dd>
                {router.connectionType} {router.useTls ? '(TLS)' : '(plain — enable TLS!)'}
              </dd>
              <dt className="text-muted-foreground">SSH host key</dt>
              <dd className="truncate font-mono text-xs" title={router.sshHostKeySha256 ?? ''}>
                {router.sshHostKeySha256 ? `SHA256:${router.sshHostKeySha256.slice(0, 16)}…` : 'not pinned yet'}
              </dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">CPU</span>
              <Meter value={l?.cpuLoad} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Memory</span>
              <div className="text-right">
                <Meter value={mem} warn={80} crit={95} />
                <div className="text-xs text-muted-foreground">
                  {formatBytes(l?.memUsed)} / {formatBytes(l?.memTotal)}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Temperature</span>
              <span className="tabular-nums">{l?.temperature ? `${l.temperature} °C` : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active PPP</span>
              <span className="tabular-nums">{l?.pppActive ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Throughput</span>
              <span className="tabular-nums">
                ↓ {formatBps(l?.rxBps)} · ↑ {formatBps(l?.txBps)}
              </span>
            </div>
            {l?.error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{l.error}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <TimeChart
              title="CPU load — last hour"
              data={points}
              series={[{ key: 'cpu', label: 'CPU', color: 'var(--series-1)' }]}
              format={(v) => `${Math.round(v)}%`}
              yMax={100}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <TimeChart
            title="Throughput on physical ports — last hour"
            data={points}
            series={[
              { key: 'rx', label: 'Rx', color: 'var(--series-1)' },
              { key: 'tx', label: 'Tx', color: 'var(--series-2)' },
            ]}
            format={formatBps}
          />
        </CardContent>
      </Card>

      {l?.interfaces && (
        <Card>
          <CardHeader>
            <CardTitle>Interface traffic (live)</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Interface</TH>
                <TH>Type</TH>
                <TH>Link</TH>
                <TH className="text-right">Rx</TH>
                <TH className="text-right">Tx</TH>
              </TR>
            </THead>
            <TBody>
              {l.interfaces.map((i) => (
                <TR key={i.name} className={i.disabled ? 'opacity-50' : undefined}>
                  <TD className="font-mono text-xs">{i.name}</TD>
                  <TD className="text-xs">{i.type}</TD>
                  <TD>
                    {i.disabled ? (
                      <Badge variant="secondary">disabled</Badge>
                    ) : i.running ? (
                      <Badge variant="success">up</Badge>
                    ) : (
                      <Badge variant="destructive">down</Badge>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{formatBps(i.rxBps)}</TD>
                  <TD className="text-right tabular-nums">{formatBps(i.txBps)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export default function RouterPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const [tab, setTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data: router, error } = useQuery({ queryKey: ['router', id], queryFn: () => get<RouterRow>(`/routers/${id}`) });
  // Kept current by the WebSocket (see lib/live.ts).
  const { data: live } = useQuery({
    queryKey: ['live', id],
    queryFn: () => get<RouterLive | null>(`/monitoring/routers/${id}/live`),
    enabled: can('monitoring:read'),
  });
  const status = live?.status ?? router?.status;
  const tabs = useMemo(() => TABS.filter((t) => can(t.perm)), [can]);

  const run = async (label: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      setMessage(`${label}: done`);
    } catch (e) {
      setMessage(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!router) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <PageHeader
        title={router.name}
        description={`${router.host}${router.port ? `:${router.port}` : ''}${router.group ? ` · ${router.group.name}` : ''}`}
        actions={
          <>
            {status && <StatusBadge status={status} />}
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => run('Refresh', async () => {
                await post(`/routers/${id}/refresh`);
                await qc.invalidateQueries({ queryKey: ['router', id] });
              })}
            >
              <RefreshCw className={busy === 'Refresh' ? 'animate-spin' : ''} /> Test & refresh
            </Button>
            {can('router:write') && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can('system:reboot') && (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => run('Reboot', () => post(`/routers/${id}/system/reboot`), `Reboot ${router.name}? Traffic will be interrupted.`)}
              >
                <Power /> Reboot
              </Button>
            )}
            {can('router:delete') && (
              <Button
                size="sm"
                variant="destructive"
                disabled={!!busy}
                onClick={() =>
                  run(
                    'Delete',
                    async () => {
                      await del(`/routers/${id}`);
                      await qc.invalidateQueries({ queryKey: ['routers'] });
                      nav.replace('/routers');
                    },
                    `Remove ${router.name} from the platform? (The device itself is not changed.)`,
                  )
                }
              >
                <Trash2 /> Remove
              </Button>
            )}
          </>
        }
      />
      {message && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{message}</p>}
      <div className="mb-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'overview' && <Overview router={router} />}
      {tab === 'interfaces' && <ResourceTab routerId={id} def={RESOURCE_DEFS.interfaces} />}
      {tab === 'ip' && (
        <div className="space-y-4">
          <ResourceTab routerId={id} def={RESOURCE_DEFS.addresses} />
          <ResourceTab routerId={id} def={RESOURCE_DEFS.routes} />
        </div>
      )}
      {tab === 'firewall' && <ResourceTab routerId={id} def={RESOURCE_DEFS.filter} />}
      {tab === 'nat' && <ResourceTab routerId={id} def={RESOURCE_DEFS.nat} />}
      {tab === 'address-lists' && <ResourceTab routerId={id} def={RESOURCE_DEFS.addressList} />}
      {tab === 'dhcp' && (
        <div className="space-y-4">
          <ResourceTab routerId={id} def={RESOURCE_DEFS.dhcpServers} />
          <ResourceTab routerId={id} def={RESOURCE_DEFS.dhcpLeases} />
        </div>
      )}
      {tab === 'ppp' && (
        <div className="space-y-4">
          <ResourceTab routerId={id} def={RESOURCE_DEFS.pppActive} />
          <ResourceTab routerId={id} def={RESOURCE_DEFS.pppSecrets} />
        </div>
      )}
      {tab === 'queues' && <ResourceTab routerId={id} def={RESOURCE_DEFS.queues} />}
      {tab === 'logs' && <LogsTab routerId={id} />}
      {tab === 'backups' && <BackupsTab routerId={id} />}

      <Dialog open={editing} onClose={() => setEditing(false)} title={`Edit ${router.name}`} className="max-w-2xl">
        <RouterForm
          router={router}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await patch(`/routers/${id}`, body);
            setEditing(false);
            await qc.invalidateQueries({ queryKey: ['router', id] });
          }}
        />
      </Dialog>
    </>
  );
}
