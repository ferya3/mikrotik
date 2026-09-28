'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, GitCompare, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { Backup } from '@/lib/types';
import { formatBytes, formatDate } from '@/lib/utils';

interface Diff {
  from: { id: string; createdAt: string };
  to: { id: string; createdAt: string };
  identical: boolean;
  patch: string;
}

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split('\n').slice(4); // drop the file header
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md border bg-background p-3 text-xs leading-5">
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith('+') ? 'bg-success/10 text-success' : l.startsWith('-') ? 'bg-destructive/10 text-destructive' : l.startsWith('@@') ? 'text-primary' : 'text-muted-foreground'
          }
        >
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

export function BackupsTab({ routerId }: { routerId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['backups', routerId],
    queryFn: () => get<Backup[]>(`/routers/${routerId}/backups`),
    // Poll only while a job is in flight.
    refetchInterval: (query) => (query.state.data?.some((b) => b.status === 'PENDING' || b.status === 'RUNNING') ? 3000 : false),
  });

  const backupNow = async () => {
    setError(null);
    try {
      await post(`/routers/${routerId}/backups`);
      await qc.invalidateQueries({ queryKey: ['backups', routerId] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const showDiff = async (id: string) => {
    setError(null);
    try {
      setDiff(await get<Diff>(`/backups/${id}/diff`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const download = async (b: Backup) => {
    const full = await get<{ content: string }>(`/backups/${b.id}`);
    const url = URL.createObjectURL(new Blob([full.content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-${b.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.rsc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (s: Backup['status']) =>
    s === 'SUCCESS' ? <Badge variant="success">success</Badge> : s === 'FAILED' ? <Badge variant="destructive">failed</Badge> : <Badge variant="secondary">{s.toLowerCase()}…</Badge>;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <div>
          <h3 className="text-sm font-semibold">Configuration backups</h3>
          <p className="text-xs text-muted-foreground">Text exports over SSH (`/export terse`), scheduled daily and on demand.</p>
        </div>
        {can('backup:create') && (
          <Button size="sm" onClick={backupNow}>
            <Plus /> Backup now
          </Button>
        )}
      </div>
      {error && <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Table>
        <THead>
          <TR>
            <TH>Created</TH>
            <TH>Status</TH>
            <TH>Size</TH>
            <TH>SHA-256</TH>
            <TH>By</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {q.data?.length === 0 && (
            <TR>
              <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                No backups yet
              </TD>
            </TR>
          )}
          {q.data?.map((b) => (
            <TR key={b.id}>
              <TD className="whitespace-nowrap text-xs">{formatDate(b.createdAt)}</TD>
              <TD>
                {statusBadge(b.status)}
                {b.error && <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={b.error}>{b.error}</div>}
              </TD>
              <TD className="text-xs">{formatBytes(b.sizeBytes)}</TD>
              <TD className="font-mono text-xs">{b.sha256?.slice(0, 12) ?? '—'}</TD>
              <TD className="text-xs">{b.createdBy?.username ?? 'scheduler'}</TD>
              <TD className="text-right">
                {b.status === 'SUCCESS' && (
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => showDiff(b.id)}>
                      <GitCompare /> Diff vs previous
                    </Button>
                    <Button size="icon" variant="ghost" title="Download .rsc" onClick={() => download(b)}>
                      <Download />
                    </Button>
                  </div>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={!!diff} onClose={() => setDiff(null)} title="Configuration diff" className="max-w-4xl">
        {diff && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {formatDate(diff.from.createdAt)} → {formatDate(diff.to.createdAt)}
            </p>
            {diff.identical ? <p className="text-sm">No configuration changes.</p> : <DiffView patch={diff.patch} />}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
