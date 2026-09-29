'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BarChart3, Gauge, LockOpen, RefreshCw, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatBps, formatBytes } from '@/lib/utils';

interface ClientLimit {
  download: number;
  upload: number;
  source: 'queue' | 'ppp';
  queueName?: string;
  managed: boolean;
}

export interface NetworkClient {
  key: string;
  type: 'dhcp' | 'ppp' | 'hotspot' | 'static';
  address: string | null;
  mac: string | null;
  name: string | null;
  comment: string | null;
  online: boolean;
  pppUser: string | null;
  uptime: string | null;
  downloadBps: number | null;
  uploadBps: number | null;
  todayDownloadBytes: number;
  todayUploadBytes: number;
  limit: ClientLimit | null;
  tracked: boolean;
  queueName: string | null;
  blocked: boolean;
  blockReason: string | null;
  blockTimeout: string | null;
}

interface ClientsResponse {
  summary: { total: number; online: number; blocked: number; limited: number; downloadBps: number; uploadBps: number };
  clients: NetworkClient[];
}

interface UsageTotal {
  key: string;
  label: string | null;
  downloadBytes: number;
  uploadBytes: number;
}

const ref = (c: NetworkClient) => (c.pppUser ? { pppUser: c.pppUser } : { address: c.address });
const displayName = (c: NetworkClient) => c.name || c.comment || c.address || c.key;

const PRESETS: { label: string; download: string; upload: string }[] = [
  { label: '1 Mbps', download: '1M', upload: '256k' },
  { label: '2 Mbps', download: '2M', upload: '512k' },
  { label: '5 Mbps', download: '5M', upload: '1M' },
  { label: '10 Mbps', download: '10M', upload: '2M' },
  { label: '20 Mbps', download: '20M', upload: '5M' },
];

function LimitForm({ routerId, client, onDone }: { routerId: string; client: NetworkClient; onDone: () => void }) {
  const [download, setDownload] = useState(client.limit ? `${Math.round(client.limit.download / 1000)}k` : '5M');
  const [upload, setUpload] = useState(client.limit ? `${Math.round(client.limit.upload / 1000)}k` : '1M');
  const [reconnect, setReconnect] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPpp = !!client.pppUser;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/routers/${routerId}/clients/limit`, { ...ref(client), download, upload, ...(isPpp ? { reconnect } : {}) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            type="button"
            size="sm"
            variant={download === p.download && upload === p.upload ? 'default' : 'outline'}
            onClick={() => {
              setDownload(p.download);
              setUpload(p.upload);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="dl">Download limit</Label>
          <Input id="dl" value={download} onChange={(e) => setDownload(e.target.value)} placeholder="5M" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ul">Upload limit</Label>
          <Input id="ul" value={upload} onChange={(e) => setUpload(e.target.value)} placeholder="1M" required />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Units: k, M, G (bits per second), e.g. 512k, 10M.</p>
      {isPpp ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={reconnect} onChange={(e) => setReconnect(e.target.checked)} />
          <span>
            Reconnect the session now so the limit applies immediately
            <span className="block text-xs text-muted-foreground">Otherwise it applies on the next login (PPP rate-limit).</span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">
          {client.queueName
            ? `Sets max-limit on the client's queue “${client.queueName}”. Takes effect immediately.`
            : `Creates the simple queue nms-${client.address} at the top of the queue list. Takes effect immediately.`}
        </p>
      )}
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          <Gauge /> {busy ? 'Applying…' : 'Apply limit'}
        </Button>
      </div>
    </form>
  );
}

function BlockForm({ routerId, client, onDone }: { routerId: string; client: NetworkClient; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isPpp = !!client.pppUser;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/routers/${routerId}/clients/block`, { ...ref(client), reason: reason || undefined, duration: duration || undefined });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm">
        {isPpp ? (
          <>
            Disables the PPP account <b>{client.pppUser}</b> and disconnects its session. It stays blocked until you unblock it.
          </>
        ) : (
          <>
            Adds <b className="font-mono">{client.address}</b> to the address list <code>nms-blocked</code> (dropped in the forward chain) and cuts its
            open connections. The device can still reach the router itself.
          </>
        )}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (recorded on the router and in the audit log)</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Heavy downloading" maxLength={200} />
      </div>
      {!isPpp && (
        <div className="space-y-1.5">
          <Label htmlFor="dur">Duration</Label>
          <Select id="dur" value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="">Until unblocked</option>
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
            <option value="1d">1 day</option>
            <option value="7d">7 days</option>
          </Select>
        </div>
      )}
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={busy}>
          <Ban /> {busy ? 'Blocking…' : 'Block'}
        </Button>
      </div>
    </form>
  );
}

function HistoryView({ routerId, client }: { routerId: string; client: NetworkClient }) {
  const q = useQuery({
    queryKey: ['client-history', routerId, client.key],
    queryFn: () =>
      get<{ day: string; downloadBytes: number; uploadBytes: number }[]>(
        `/routers/${routerId}/clients/usage/history?key=${encodeURIComponent(client.key)}&days=30`,
      ),
  });
  const rows = q.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.downloadBytes + r.uploadBytes));
  const total = rows.reduce((a, r) => ({ d: a.d + r.downloadBytes, u: a.u + r.uploadBytes }), { d: 0, u: 0 });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Last 30 days: <b className="text-foreground">↓ {formatBytes(total.d)}</b> · ↑ {formatBytes(total.u)}
      </p>
      {rows.length === 0 && !q.isLoading && (
        <p className="text-sm text-muted-foreground">No usage recorded yet. Usage is counted while the client has a queue or a PPP session.</p>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Day (UTC)</TH>
            <TH className="w-1/2">Traffic</TH>
            <TH className="text-right">Download</TH>
            <TH className="text-right">Upload</TH>
          </TR>
        </THead>
        <TBody>
          {[...rows].reverse().map((r) => (
            <TR key={r.day}>
              <TD className="whitespace-nowrap font-mono text-xs">{r.day}</TD>
              <TD>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted" title={`↓ ${formatBytes(r.downloadBytes)} · ↑ ${formatBytes(r.uploadBytes)}`}>
                  <div style={{ width: `${(r.downloadBytes / max) * 100}%`, background: 'var(--series-1)' }} />
                  <div className="border-l-2 border-card" style={{ width: `${(r.uploadBytes / max) * 100}%`, background: 'var(--series-2)' }} />
                </div>
              </TD>
              <TD className="text-right tabular-nums">{formatBytes(r.downloadBytes)}</TD>
              <TD className="text-right tabular-nums">{formatBytes(r.uploadBytes)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: 'var(--series-1)' }} /> Download
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: 'var(--series-2)' }} /> Upload
        </span>
      </div>
    </div>
  );
}

type Dialogs = { kind: 'limit' | 'block' | 'history'; client: NetworkClient } | null;

function LiveClients({ routerId }: { routerId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const canWrite = can('client:write');
  const [filter, setFilter] = useState('');
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ['clients', routerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => get<ClientsResponse>(`/routers/${routerId}/clients`),
    // Live rates come straight from the router (9 menus per refresh), so keep this modest
    // to spare the router's CPU. Stops automatically when the browser tab is hidden.
    refetchInterval: 15000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const run = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const clients = (q.data?.clients ?? []).filter(
    (c) =>
      (!onlyOnline || c.online || c.blocked) &&
      (!filter || [c.name, c.address, c.mac, c.comment, c.pppUser].some((v) => v?.toLowerCase().includes(filter.toLowerCase()))),
  );
  const untracked = (q.data?.clients ?? []).filter((c) => !c.tracked && !c.pppUser && c.address && c.online);
  const s = q.data?.summary;
  const topDown = Math.max(1, ...clients.map((c) => c.downloadBps ?? 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Online clients', s ? `${s.online} / ${s.total}` : '—'],
          ['Total download', formatBps(s?.downloadBps)],
          ['Total upload', formatBps(s?.uploadBps)],
          ['Limited', s?.limited ?? '—'],
          ['Blocked', s?.blocked ?? '—'],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div>
            <h3 className="text-sm font-semibold">Clients — heaviest downloaders first</h3>
            <p className="text-xs text-muted-foreground">DHCP, PPP, hotspot and static devices. Refreshes every 15 seconds.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} /> Online only
            </label>
            <Input placeholder="Name, IP, MAC…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-44" />
            <Button size="sm" variant="outline" onClick={refresh} aria-label="Refresh">
              <RefreshCw className={q.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>

        {canWrite && untracked.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
            <span>
              {untracked.length} online device(s) have no queue, so their live rate and usage are unknown.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                run(
                  () => post(`/routers/${routerId}/clients/track`, { addresses: untracked.map((c) => c.address) }),
                  `Create an unlimited accounting queue (nms-<ip>) for ${untracked.length} device(s)?`,
                )
              }
            >
              Start measuring usage
            </Button>
          </div>
        )}

        {(error || q.error) && (
          <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error ?? (q.error as Error).message}</p>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Address</TH>
              <TH>Type</TH>
              <TH className="text-right">Download now</TH>
              <TH className="text-right">Upload now</TH>
              <TH className="text-right">Today</TH>
              <TH>Limit</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {q.isLoading && (
              <TR>
                <TD colSpan={9} className="py-8 text-center text-muted-foreground">
                  Reading clients from the router…
                </TD>
              </TR>
            )}
            {!q.isLoading && clients.length === 0 && (
              <TR>
                <TD colSpan={9} className="py-8 text-center text-muted-foreground">
                  No clients
                </TD>
              </TR>
            )}
            {clients.map((c) => (
              <TR key={c.key} className={cn(!c.online && !c.blocked && 'opacity-60')}>
                <TD>
                  <div className="font-medium">{displayName(c)}</div>
                  {c.name && c.comment && <div className="text-xs text-muted-foreground">{c.comment}</div>}
                </TD>
                <TD className="font-mono text-xs">
                  {c.address ?? '—'}
                  {c.mac && <div className="text-muted-foreground">{c.mac}</div>}
                </TD>
                <TD>
                  <Badge variant="outline">{c.type}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">
                  {c.downloadBps === null ? (
                    <span className="text-muted-foreground" title="No queue for this device">—</span>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted 2xl:block">
                        <div className="h-full" style={{ width: `${((c.downloadBps ?? 0) / topDown) * 100}%`, background: 'var(--series-1)' }} />
                      </div>
                      {formatBps(c.downloadBps)}
                    </div>
                  )}
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{c.uploadBps === null ? '—' : formatBps(c.uploadBps)}</TD>
                <TD className="whitespace-nowrap text-right text-xs tabular-nums">
                  ↓ {formatBytes(c.todayDownloadBytes)}
                  <div className="text-muted-foreground">↑ {formatBytes(c.todayUploadBytes)}</div>
                </TD>
                <TD className="whitespace-nowrap text-xs">
                  {c.limit ? (
                    <div className="text-warning" title={c.limit.queueName ?? 'PPP rate-limit'}>
                      ↓ {formatBps(c.limit.download)}
                      <div>↑ {formatBps(c.limit.upload)}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">unlimited</span>
                  )}
                </TD>
                <TD>
                  {c.blocked ? (
                    <div title={c.blockReason ?? undefined}>
                      <Badge variant="destructive" className="whitespace-nowrap">
                        <Ban className="size-3" /> blocked
                      </Badge>
                      {c.blockTimeout && <div className="mt-0.5 text-xs text-muted-foreground">{c.blockTimeout} left</div>}
                    </div>
                  ) : c.online ? (
                    <Badge variant="success">online</Badge>
                  ) : (
                    <Badge variant="secondary">offline</Badge>
                  )}
                </TD>
                <TD className="whitespace-nowrap text-right">
                  <div className="inline-flex gap-1">
                    <Button size="icon" variant="ghost" title="Usage history" onClick={() => setDialog({ kind: 'history', client: c })}>
                      <BarChart3 />
                    </Button>
                    {canWrite && !c.blocked && (c.address || c.pppUser) && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'limit', client: c })}>
                          <Gauge /> Limit
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDialog({ kind: 'block', client: c })}>
                          <Ban /> Block
                        </Button>
                      </>
                    )}
                    {canWrite && c.limit && !c.blocked && (c.limit.source === 'ppp' ? c.pppUser : true) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Remove limit"
                        onClick={() =>
                          run(
                            () => post(`/routers/${routerId}/clients/unlimit`, { ...ref(c), ...(c.pppUser ? { reconnect: true } : {}) }),
                            `Remove the bandwidth limit of ${displayName(c)}?${c.pppUser ? ' The session will reconnect.' : ''}`,
                          )
                        }
                      >
                        <Unlink />
                      </Button>
                    )}
                    {canWrite && c.blocked && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => run(() => post(`/routers/${routerId}/clients/unblock`, ref(c)), `Unblock ${displayName(c)}?`)}
                      >
                        <LockOpen /> Unblock
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          dialog
            ? `${dialog.kind === 'limit' ? 'Limit bandwidth' : dialog.kind === 'block' ? 'Block' : 'Usage'} — ${displayName(dialog.client)}`
            : ''
        }
        className={dialog?.kind === 'history' ? 'max-w-2xl' : undefined}
      >
        {dialog?.kind === 'limit' && (
          <LimitForm
            routerId={routerId}
            client={dialog.client}
            onDone={() => {
              setDialog(null);
              void refresh();
            }}
          />
        )}
        {dialog?.kind === 'block' && (
          <BlockForm
            routerId={routerId}
            client={dialog.client}
            onDone={() => {
              setDialog(null);
              void refresh();
            }}
          />
        )}
        {dialog?.kind === 'history' && <HistoryView routerId={routerId} client={dialog.client} />}
      </Dialog>
    </div>
  );
}

function UsageReport({ routerId }: { routerId: string }) {
  const [days, setDays] = useState('30');
  const q = useQuery({
    queryKey: ['client-usage', routerId, days],
    queryFn: () => get<UsageTotal[]>(`/routers/${routerId}/clients/usage?days=${days}`),
  });
  // Names (DHCP host name / PPP user) come from the live client list.
  const live = useQuery({ queryKey: ['clients', routerId], queryFn: () => get<ClientsResponse>(`/routers/${routerId}/clients`) });
  const names = new Map((live.data?.clients ?? []).map((c) => [c.key, displayName(c)]));
  const rows = q.data ?? [];
  const total = rows.reduce((a, r) => a + r.downloadBytes + r.uploadBytes, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h3 className="text-sm font-semibold">Internet usage per client</h3>
          <p className="text-xs text-muted-foreground">Accumulated by the monitoring poller from queue and PPP counters (UTC days).</p>
        </div>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-36">
          <option value="1">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>#</TH>
            <TH>Client</TH>
            <TH className="text-right">Download</TH>
            <TH className="text-right">Upload</TH>
            <TH className="text-right">Total</TH>
            <TH className="w-40">Share</TH>
          </TR>
        </THead>
        <TBody>
          {rows.length === 0 && !q.isLoading && (
            <TR>
              <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                No usage recorded for this period yet
              </TD>
            </TR>
          )}
          {rows.map((r, i) => {
            const sum = r.downloadBytes + r.uploadBytes;
            const share = total ? (sum / total) * 100 : 0;
            return (
              <TR key={r.key}>
                <TD className="text-xs text-muted-foreground">{i + 1}</TD>
                <TD>
                  <div className="font-medium">{names.get(r.key) ?? r.label ?? r.key.replace(/^(ip|ppp):/, '')}</div>
                  <div className="font-mono text-xs text-muted-foreground">{r.key}</div>
                </TD>
                <TD className="text-right tabular-nums">{formatBytes(r.downloadBytes)}</TD>
                <TD className="text-right tabular-nums">{formatBytes(r.uploadBytes)}</TD>
                <TD className="text-right font-medium tabular-nums">{formatBytes(sum)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full" style={{ width: `${share}%`, background: 'var(--series-1)' }} />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums">{share.toFixed(0)}%</span>
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

export function ClientsTab({ routerId }: { routerId: string }) {
  const [view, setView] = useState<'live' | 'usage'>('live');
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { value: 'live', label: 'Live & control' },
          { value: 'usage', label: 'Usage report' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'live' ? <LiveClients routerId={routerId} /> : <UsageReport routerId={routerId} />}
    </div>
  );
}
