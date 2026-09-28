'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get } from '@/lib/api';
import type { AuditLog } from '@/lib/types';
import { formatDate } from '@/lib/utils';

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit', action],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      get<{ items: AuditLog[]; nextCursor: string | null }>(
        `/audit-logs?take=50${pageParam ? `&cursor=${pageParam}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title="Audit log" description="Every change: who, what, where, when, and the state before and after." />
      <Card>
        <div className="border-b p-3">
          <Input placeholder="Filter by action, e.g. FIREWALL" value={action} onChange={(e) => setAction(e.target.value)} className="h-8 max-w-xs" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Time</TH>
              <TH>User</TH>
              <TH>Action</TH>
              <TH>Router</TH>
              <TH>Target</TH>
              <TH>IP</TH>
              <TH>Result</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <TR className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <TD className="whitespace-nowrap text-xs">{formatDate(r.createdAt)}</TD>
                  <TD>{r.username ?? 'system'}</TD>
                  <TD className="font-mono text-xs">{r.action}</TD>
                  <TD>{r.router?.name ?? '—'}</TD>
                  <TD className="font-mono text-xs">
                    {r.targetType}
                    {r.targetId ? ` ${r.targetId}` : ''}
                  </TD>
                  <TD className="font-mono text-xs">{r.ip}</TD>
                  <TD>
                    <Badge variant={r.result === 'SUCCESS' ? 'success' : 'destructive'}>{r.result.toLowerCase()}</Badge>
                  </TD>
                </TR>
                {open === r.id && (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={7} className="bg-muted/30">
                      {r.error && <p className="mb-2 text-sm text-destructive">{r.error}</p>}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">BEFORE</p>
                          <Json value={r.before} />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-muted-foreground">AFTER</p>
                          <Json value={r.after} />
                        </div>
                      </div>
                    </TD>
                  </TR>
                )}
              </Fragment>
            ))}
          </TBody>
        </Table>
        {q.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button size="sm" variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
