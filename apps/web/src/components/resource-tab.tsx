'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Pencil, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { del, get, patch, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { RosRow } from '@/lib/types';
import { FieldSpec, ResourceForm } from './resource-form';

export interface Column {
  key: string;
  label: string;
  render?: (row: RosRow) => React.ReactNode;
  mono?: boolean;
}

export interface RowAction {
  label: string;
  confirm?: string;
  run: (routerId: string, row: RosRow) => Promise<unknown>;
  show?: (row: RosRow) => boolean;
}

export interface ResourceDef {
  title: string;
  /** API path under /routers/:id, e.g. "/firewall/filter". */
  endpoint: string;
  read: string;
  write: string[];
  columns: Column[];
  createFields?: FieldSpec[];
  editFields?: FieldSpec[];
  canDelete?: boolean;
  deleteLabel?: string;
  canToggle?: boolean;
  /** Ordered lists (firewall/NAT) get a "move up" action. */
  orderable?: boolean;
  rowActions?: RowAction[];
}

const isTrue = (v: string | undefined) => v === 'true' || v === 'yes';

export function ResourceTab({ routerId, def }: { routerId: string; def: ResourceDef }) {
  const can = useCan();
  const qc = useQueryClient();
  const key = ['ros', routerId, def.endpoint];
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<RosRow | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = can(...def.write);

  const q = useQuery({ queryKey: key, queryFn: () => get<RosRow[]>(`/routers/${routerId}${def.endpoint}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const rows = (q.data ?? []).filter(
    (r) => !filter || Object.values(r).some((v) => v?.toLowerCase().includes(filter.toLowerCase())),
  );
  const url = (id: string) => `/routers/${routerId}${def.endpoint}/${encodeURIComponent(id)}`;

  const confirmRun = (message: string, fn: () => Promise<unknown>) => {
    if (window.confirm(message)) act.mutate(fn);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{def.title}</h3>
          <Badge variant="secondary">{q.data?.length ?? 0}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-44" />
          <Button size="sm" variant="outline" onClick={refresh} aria-label="Refresh">
            <RefreshCw className={q.isFetching ? 'animate-spin' : ''} />
          </Button>
          {def.createFields && canWrite && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> Add
            </Button>
          )}
        </div>
      </div>

      {(q.error || actionError) && (
        <p className="m-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError ?? (q.error as Error).message}
        </p>
      )}

      <Table>
        <THead>
          <TR>
            {def.orderable && <TH className="w-8">#</TH>}
            {def.columns.map((c) => (
              <TH key={c.key}>{c.label}</TH>
            ))}
            {canWrite && <TH className="text-right">Actions</TH>}
          </TR>
        </THead>
        <TBody>
          {q.isLoading && (
            <TR>
              <TD colSpan={99} className="py-8 text-center text-muted-foreground">
                Loading from router…
              </TD>
            </TR>
          )}
          {!q.isLoading && rows.length === 0 && (
            <TR>
              <TD colSpan={99} className="py-8 text-center text-muted-foreground">
                No entries
              </TD>
            </TR>
          )}
          {rows.map((row, idx) => {
            const disabled = isTrue(row.disabled);
            const dynamic = isTrue(row.dynamic);
            return (
              <TR key={row['.id']} className={disabled ? 'opacity-50' : undefined}>
                {def.orderable && <TD className="text-xs text-muted-foreground">{idx}</TD>}
                {def.columns.map((c) => (
                  <TD key={c.key} className={c.mono ? 'font-mono text-xs' : undefined}>
                    {c.render ? c.render(row) : row[c.key] || <span className="text-muted-foreground">—</span>}
                  </TD>
                ))}
                {canWrite && (
                  <TD className="whitespace-nowrap text-right">
                    <div className="inline-flex gap-1">
                      {def.rowActions
                        ?.filter((a) => !a.show || a.show(row))
                        .map((a) => (
                          <Button
                            key={a.label}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              a.confirm ? confirmRun(a.confirm, () => a.run(routerId, row)) : act.mutate(() => a.run(routerId, row))
                            }
                          >
                            {a.label}
                          </Button>
                        ))}
                      {def.orderable && idx > 0 && !filter && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Move up"
                          onClick={() => act.mutate(() => post(`${url(row['.id'])}/move`, { before: rows[idx - 1]['.id'] }))}
                        >
                          <ArrowUp />
                        </Button>
                      )}
                      {def.canToggle && !dynamic && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title={disabled ? 'Enable' : 'Disable'}
                          onClick={() =>
                            confirmRun(`${disabled ? 'Enable' : 'Disable'} this entry on the router?`, () =>
                              patch(url(row['.id']), { disabled: !disabled }),
                            )
                          }
                        >
                          <Power className={disabled ? '' : 'text-success'} />
                        </Button>
                      )}
                      {def.editFields && !dynamic && (
                        <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing(row)}>
                          <Pencil />
                        </Button>
                      )}
                      {def.canDelete && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title={def.deleteLabel ?? 'Delete'}
                          onClick={() => confirmRun(`${def.deleteLabel ?? 'Delete'} ${row['.id']}? This changes the live router.`, () => del(url(row['.id'])))}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TD>
                )}
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? `Add — ${def.title}` : `Edit ${editing?.['.id'] ?? ''}`}
        className="max-w-2xl"
      >
        {editing !== null && (
          <ResourceForm
            fields={(editing === 'new' ? def.createFields : def.editFields) ?? []}
            row={editing === 'new' ? undefined : editing}
            submitLabel={editing === 'new' ? 'Create' : 'Save'}
            onCancel={() => setEditing(null)}
            onSubmit={async (body) => {
              if (editing === 'new') await post(`/routers/${routerId}${def.endpoint}`, body);
              else await patch(url(editing['.id']), body);
              setEditing(null);
              await refresh();
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}
