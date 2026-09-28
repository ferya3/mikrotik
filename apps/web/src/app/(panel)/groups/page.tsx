'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Rocket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { FieldSpec, ResourceForm } from '@/components/resource-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { del, get, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { RESOURCE_DEFS } from '@/lib/resources';
import type { RouterGroup } from '@/lib/types';

type Kind = 'firewall.filter' | 'firewall.address-list';

interface PlanItem {
  routerId: string;
  routerName: string;
  action: 'create' | 'skip' | 'error';
  reason?: string;
  result?: 'created' | 'failed';
  id?: string;
  error?: string;
}

interface DeployResult {
  dryRun: boolean;
  props: Record<string, string>;
  plan: PlanItem[];
}

const KIND_FIELDS: Record<Kind, FieldSpec[]> = {
  // Rule ids differ per router, so bulk rules are always appended.
  'firewall.filter': RESOURCE_DEFS.filter.createFields.filter((f) => f.name !== 'placeBefore'),
  'firewall.address-list': RESOURCE_DEFS.addressList.createFields,
};

function Deploy({ group, onClose }: { group: RouterGroup; onClose: () => void }) {
  const can = useCan();
  const kinds = (['firewall.address-list', 'firewall.filter'] as Kind[]).filter((k) =>
    k === 'firewall.filter' ? can('firewall:write') : can('firewall:write', 'firewall:address-list'),
  );
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deploy = async (dryRun: boolean, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await post<DeployResult>(`/router-groups/${group.id}/deploy`, { kind, dryRun, payload: body });
      setPlan(res);
      setPayload(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toCreate = plan?.plan.filter((p) => p.action === 'create').length ?? 0;

  return (
    <div className="space-y-4">
      {!plan && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="kind">What to deploy</Label>
            <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k === 'firewall.filter' ? 'Firewall filter rule' : 'Address-list entry'}
                </option>
              ))}
            </Select>
          </div>
          <ResourceForm key={kind} fields={KIND_FIELDS[kind]} submitLabel="Preview (dry run)" onCancel={onClose} onSubmit={(b) => deploy(true, b)} />
        </>
      )}
      {plan && (
        <>
          <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {Object.entries(plan.props)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Router</TH>
                <TH>Plan</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {plan.plan.map((p) => (
                <TR key={p.routerId}>
                  <TD>{p.routerName}</TD>
                  <TD>
                    <Badge variant={p.action === 'create' ? 'default' : p.action === 'skip' ? 'secondary' : 'destructive'}>{p.action}</Badge>
                    {p.reason && <span className="ml-2 text-xs text-muted-foreground">{p.reason}</span>}
                  </TD>
                  <TD className="text-xs">
                    {p.result === 'created' && <Badge variant="success">created {p.id}</Badge>}
                    {p.result === 'failed' && <span className="text-destructive">{p.error}</span>}
                  </TD>
                </TR>
              ))}
              {plan.plan.length === 0 && (
                <TR>
                  <TD colSpan={3} className="py-6 text-center text-muted-foreground">
                    No routers in this group
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => (plan.dryRun ? setPlan(null) : onClose())}>
              {plan.dryRun ? 'Back' : 'Close'}
            </Button>
            {plan.dryRun && (
              <Button
                disabled={busy || toCreate === 0}
                onClick={() => window.confirm(`Apply to ${toCreate} router(s)?`) && payload && deploy(false, payload)}
              >
                <Rocket /> Apply to {toCreate} router(s)
              </Button>
            )}
          </div>
        </>
      )}
      {!plan && error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function GroupsPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { data } = useQuery({ queryKey: ['groups'], queryFn: () => get<RouterGroup[]>('/router-groups') });
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState<RouterGroup | null>(null);
  const byId = new Map(data?.map((g) => [g.id, g]));

  const path = (g: RouterGroup): string => {
    const parts = [g.name];
    let cur = g.parentId ? byId.get(g.parentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(' / ');
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await post('/router-groups', { name, parentId: parentId || undefined });
      setName('');
      await qc.invalidateQueries({ queryKey: ['groups'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (g: RouterGroup) => {
    if (!window.confirm(`Delete group ${g.name}? Routers stay, they just become ungrouped.`)) return;
    try {
      await del(`/router-groups/${g.id}`);
      await qc.invalidateQueries({ queryKey: ['groups'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canDeploy = can('firewall:write', 'firewall:address-list');

  return (
    <>
      <PageHeader title="Groups & bulk operations" description="Organise routers and deploy a change to a whole group — always previewed with a dry run first." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <THead>
              <TR>
                <TH>Group</TH>
                <TH>Routers</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data?.map((g) => (
                <TR key={g.id}>
                  <TD>{path(g)}</TD>
                  <TD>{g._count.routers}</TD>
                  <TD className="text-right">
                    <div className="inline-flex gap-1">
                      {canDeploy && (
                        <Button size="sm" variant="outline" onClick={() => setDeploying(g)}>
                          <Rocket /> Deploy
                        </Button>
                      )}
                      {can('router:delete') && (
                        <Button size="icon" variant="ghost" onClick={() => remove(g)} title="Delete group">
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
              {data?.length === 0 && (
                <TR>
                  <TD colSpan={3} className="py-8 text-center text-muted-foreground">
                    No groups yet
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
        </Card>
        {can('router:write') && (
          <Card>
            <CardHeader>
              <CardTitle>New group</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={create} className="space-y-3">
                <Input placeholder="Branches" value={name} onChange={(e) => setName(e.target.value)} required />
                <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">— top level —</option>
                  {data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      under {path(g)}
                    </option>
                  ))}
                </Select>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full">
                  <Plus /> Create group
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
      <Dialog open={!!deploying} onClose={() => setDeploying(null)} title={`Deploy to ${deploying?.name ?? ''} (incl. sub-groups)`} className="max-w-3xl">
        {deploying && <Deploy group={deploying} onClose={() => setDeploying(null)} />}
      </Dialog>
    </>
  );
}
