'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/auth';
import type { Alert } from '@/lib/types';
import { formatDate } from '@/lib/utils';

type StateFilter = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ALL';

export default function AlertsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [state, setState] = useState<StateFilter>('OPEN');
  const { data } = useQuery({
    queryKey: ['alerts', state],
    queryFn: () => get<Alert[]>(`/alerts${state === 'ALL' ? '' : `?state=${state}`}`),
  });

  const ack = async (id: string) => {
    await post(`/alerts/${id}/ack`);
    await qc.invalidateQueries({ queryKey: ['alerts'] });
  };

  return (
    <>
      <PageHeader title="Alerts" description="Raised automatically by the monitoring poller; notifications go to Telegram when configured." />
      <div className="mb-4">
        <Tabs
          tabs={[
            { value: 'OPEN', label: 'Open' },
            { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
            { value: 'RESOLVED', label: 'Resolved' },
            { value: 'ALL', label: 'All' },
          ]}
          value={state}
          onChange={setState}
        />
      </div>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Severity</TH>
              <TH>Alert</TH>
              <TH>Router</TH>
              <TH>Opened</TH>
              <TH>Resolved</TH>
              <TH>State</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {data?.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Badge variant={a.severity === 'CRITICAL' ? 'destructive' : a.severity === 'WARNING' ? 'warning' : 'secondary'}>
                    {a.severity.toLowerCase()}
                  </Badge>
                </TD>
                <TD>
                  <div className="font-medium">{a.message}</div>
                  <div className="font-mono text-xs text-muted-foreground">{a.type}</div>
                </TD>
                <TD>
                  {a.router?.name}
                  <div className="font-mono text-xs text-muted-foreground">{a.router?.host}</div>
                </TD>
                <TD className="whitespace-nowrap text-xs">{formatDate(a.createdAt)}</TD>
                <TD className="whitespace-nowrap text-xs">{formatDate(a.resolvedAt)}</TD>
                <TD className="text-xs">{a.state.toLowerCase()}</TD>
                <TD className="text-right">
                  {a.state === 'OPEN' && can('alert:ack') && (
                    <Button size="sm" variant="outline" onClick={() => ack(a.id)}>
                      Acknowledge
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
            {data?.length === 0 && (
              <TR>
                <TD colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nothing here
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
