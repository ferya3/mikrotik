'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { get } from '@/lib/api';
import type { RouterGroup, RouterRow } from '@/lib/types';

interface FormState {
  name: string;
  host: string;
  port: string;
  connectionType: 'REST' | 'API';
  useTls: boolean;
  verifyTls: boolean;
  sshPort: string;
  groupId: string;
  location: string;
  username: string;
  password: string;
  testConnection: boolean;
}

export function RouterForm({
  router,
  onSubmit,
  onCancel,
}: {
  router?: RouterRow;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => get<RouterGroup[]>('/router-groups') });
  const [f, setF] = useState<FormState>({
    name: router?.name ?? '',
    host: router?.host ?? '',
    port: router?.port ? String(router.port) : '',
    connectionType: router?.connectionType ?? 'REST',
    useTls: router?.useTls ?? true,
    verifyTls: router?.verifyTls ?? false,
    sshPort: String(router?.sshPort ?? 22),
    groupId: router?.group?.id ?? '',
    location: router?.location ?? '',
    username: router?.username ?? '',
    password: '',
    testConnection: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const defaultPort = f.connectionType === 'REST' ? (f.useTls ? 443 : 80) : f.useTls ? 8729 : 8728;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: f.name,
        host: f.host,
        port: f.port ? Number(f.port) : undefined,
        connectionType: f.connectionType,
        useTls: f.useTls,
        verifyTls: f.verifyTls,
        sshPort: Number(f.sshPort || 22),
        groupId: f.groupId || null,
        location: f.location || undefined,
        username: f.username,
      };
      if (f.password) body.password = f.password;
      if (!router) body.testConnection = f.testConnection;
      await onSubmit(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Core-01" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="host">Host / IP *</Label>
          <Input id="host" required value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="10.0.0.1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct">Connection</Label>
          <Select id="ct" value={f.connectionType} onChange={(e) => set('connectionType', e.target.value as 'REST' | 'API')}>
            <option value="REST">REST API (RouterOS v7+)</option>
            <option value="API">RouterOS API (v6/v7)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            value={f.port}
            onChange={(e) => {
              const port = e.target.value;
              set('port', port);
              // Well-known RouterOS ports imply the transport security.
              if (port === '80' || port === '8728') set('useTls', false);
              if (port === '443' || port === '8729') set('useTls', true);
            }}
            placeholder={String(defaultPort)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.useTls} onChange={(e) => set('useTls', e.target.checked)} /> Use TLS (recommended)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.verifyTls} disabled={!f.useTls} onChange={(e) => set('verifyTls', e.target.checked)} /> Verify
          certificate
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="user">API username *</Label>
          <Input id="user" required value={f.username} onChange={(e) => set('username', e.target.value)} placeholder="nms-api" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pass">{router ? 'New password' : 'Password *'}</Label>
          <Input
            id="pass"
            type="password"
            autoComplete="new-password"
            required={!router}
            value={f.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder={router ? 'unchanged' : ''}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group">Group</Label>
          <Select id="group" value={f.groupId} onChange={(e) => set('groupId', e.target.value)}>
            <option value="">— none —</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ssh">SSH port (backups)</Label>
          <Input id="ssh" type="number" value={f.sshPort} onChange={(e) => set('sshPort', e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="loc">Location</Label>
          <Input id="loc" value={f.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        {!router && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.testConnection} onChange={(e) => set('testConnection', e.target.checked)} /> Test connection
            and credentials before saving
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Use a dedicated RouterOS user per platform (not <code>admin</code>) with only the policies you need. The password is encrypted
        with AES-256-GCM and never shown again.
      </p>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? (router ? 'Saving…' : 'Connecting…') : router ? 'Save' : 'Add router'}
        </Button>
      </div>
    </form>
  );
}
