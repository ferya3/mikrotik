'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { RouterRow } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { RouterForm } from './router-form';

export default function RoutersPage() {
  const qc = useQueryClient();
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['routers'], queryFn: () => get<RouterRow[]>('/routers') });

  const rows = (data ?? []).filter((r) =>
    [r.name, r.host, r.identity, r.group?.name, r.location].some((v) => v?.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title="Routers"
        description="Managed MikroTik devices"
        actions={
          can('router:write') && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add router
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b p-3">
          <Input placeholder="Search name, IP, group…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 max-w-xs" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Address</TH>
              <TH>Status</TH>
              <TH>Identity / board</TH>
              <TH>RouterOS</TH>
              <TH>Group</TH>
              <TH>Transport</TH>
              <TH>Last seen</TH>
            </TR>
          </THead>
          <TBody>
            {isLoading && (
              <TR>
                <TD colSpan={8} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TD>
              </TR>
            )}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/routers/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.location && <div className="text-xs text-muted-foreground">{r.location}</div>}
                </TD>
                <TD className="font-mono text-xs">
                  {r.host}
                  {r.port ? `:${r.port}` : ''}
                </TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD>
                  <div>{r.identity ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{r.boardName}</div>
                </TD>
                <TD className="text-xs">{r.version ?? '—'}</TD>
                <TD>{r.group?.name ?? <span className="text-muted-foreground">—</span>}</TD>
                <TD>
                  <Badge variant="outline">
                    {r.connectionType}
                    {r.useTls ? ' · TLS' : ''}
                  </Badge>
                </TD>
                <TD className="text-xs text-muted-foreground">{timeAgo(r.lastSeenAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add router" className="max-w-2xl">
        <RouterForm
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            await post('/routers', body);
            setAdding(false);
            await qc.invalidateQueries({ queryKey: ['routers'] });
            await qc.invalidateQueries({ queryKey: ['overview'] });
          }}
        />
      </Dialog>
    </>
  );
}
