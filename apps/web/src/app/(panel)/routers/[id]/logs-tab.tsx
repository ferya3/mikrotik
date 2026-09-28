'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get } from '@/lib/api';
import type { RosRow } from '@/lib/types';

const TOPICS = ['', 'system', 'firewall', 'dhcp', 'ppp', 'pppoe', 'interface', 'wireless', 'error', 'warning', 'critical', 'account'];

export function LogsTab({ routerId }: { routerId: string }) {
  const [topic, setTopic] = useState('');
  const q = useQuery({
    queryKey: ['logs', routerId, topic],
    queryFn: () => get<RosRow[]>(`/routers/${routerId}/system/logs?limit=300${topic ? `&topic=${topic}` : ''}`),
  });

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h3 className="text-sm font-semibold">Router log (newest first)</h3>
        <div className="flex gap-2">
          <Select value={topic} onChange={(e) => setTopic(e.target.value)} className="h-8 w-40">
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t || 'all topics'}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={() => q.refetch()} aria-label="Refresh">
            <RefreshCw className={q.isFetching ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
      {q.error && <p className="m-3 text-sm text-destructive">{(q.error as Error).message}</p>}
      <Table>
        <THead>
          <TR>
            <TH>Time</TH>
            <TH>Topics</TH>
            <TH>Message</TH>
          </TR>
        </THead>
        <TBody>
          {q.data?.map((r) => (
            <TR key={r['.id']}>
              <TD className="whitespace-nowrap font-mono text-xs">{r.time}</TD>
              <TD className="whitespace-nowrap text-xs text-muted-foreground">{r.topics}</TD>
              <TD className="font-mono text-xs">{r.message}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
