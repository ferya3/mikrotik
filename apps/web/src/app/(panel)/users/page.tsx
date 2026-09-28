'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { del, get, patch, post } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface User {
  id: string;
  username: string;
  email: string | null;
  fullName: string | null;
  isActive: boolean;
  totpEnabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  role: { id: string; name: string };
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: { permission: { key: string } }[];
  _count: { users: number };
}

function UserForm({ roles, user, onDone }: { roles: Role[]; user?: User; onDone: () => void }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [roleId, setRoleId] = useState(user?.role.id ?? roles.find((r) => r.name === 'read_only')?.id ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body: Record<string, unknown> = { fullName: fullName || undefined, email: email || undefined, roleId };
      if (password) body.password = password;
      if (user) await patch(`/users/${user.id}`, body);
      else await post('/users', { ...body, username });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Username</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required disabled={!!user} />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{user ? 'Reset password' : 'Initial password'}</Label>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} />
          <p className="text-xs text-muted-foreground">12+ characters with upper and lower case letters and a digit.</p>
        </div>
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{user ? 'Save' : 'Create user'}</Button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const can = useCan();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = can('user:write');

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const run = async (fn: () => Promise<unknown>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const allPerms = [...new Set(roles.data?.flatMap((r) => r.permissions.map((p) => p.permission.key)) ?? [])].sort();

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Permissions are enforced by the API; this matrix shows exactly what each role may do."
        actions={
          canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New user
            </Button>
          )
        }
      />
      {error && <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Card className="mb-6">
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Role</TH>
              <TH>2FA</TH>
              <TH>Status</TH>
              <TH>Last login</TH>
              {canWrite && <TH className="text-right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {users.data?.map((u) => (
              <TR key={u.id}>
                <TD>
                  <div className="font-medium">{u.username}</div>
                  <div className="text-xs text-muted-foreground">{u.fullName ?? u.email}</div>
                </TD>
                <TD>
                  <Badge variant="outline">{u.role.name}</Badge>
                </TD>
                <TD>{u.totpEnabled ? <Badge variant="success">on</Badge> : <Badge variant="warning">off</Badge>}</TD>
                <TD>
                  {!u.isActive ? (
                    <Badge variant="secondary">disabled</Badge>
                  ) : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
                    <Badge variant="destructive">locked</Badge>
                  ) : (
                    <Badge variant="success">active</Badge>
                  )}
                </TD>
                <TD className="text-xs">
                  {formatDate(u.lastLoginAt)}
                  {u.lastLoginIp && <div className="font-mono text-muted-foreground">{u.lastLoginIp}</div>}
                </TD>
                {canWrite && (
                  <TD className="whitespace-nowrap text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                      {u.id !== me?.id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(() => patch(`/users/${u.id}`, { isActive: !u.isActive }), `${u.isActive ? 'Disable' : 'Enable'} ${u.username}?`)
                          }
                        >
                          {u.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                      {u.totpEnabled && (
                        <Button size="sm" variant="outline" onClick={() => run(() => patch(`/users/${u.id}`, { resetTotp: true }), `Reset 2FA for ${u.username}?`)}>
                          Reset 2FA
                        </Button>
                      )}
                      {u.id !== me?.id && (
                        <Button size="sm" variant="destructive" onClick={() => run(() => del(`/users/${u.id}`), `Delete ${u.username}?`)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role permission matrix</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <TR>
              <TH>Permission</TH>
              {roles.data?.map((r) => (
                <TH key={r.id} className="text-center">
                  {r.name.replace('_', ' ')}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {allPerms.map((p) => (
              <TR key={p}>
                <TD className="font-mono text-xs">{p}</TD>
                {roles.data?.map((r) => (
                  <TD key={r.id} className="text-center">
                    {r.permissions.some((x) => x.permission.key === p) ? (
                      <Check className="mx-auto size-4 text-success" aria-label="allowed" />
                    ) : (
                      <X className="mx-auto size-4 text-muted-foreground/40" aria-label="denied" />
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New user' : `Edit ${editing?.username ?? ''}`}>
        {editing !== null && roles.data && (
          <UserForm
            roles={roles.data}
            user={editing === 'new' ? undefined : editing}
            onDone={() => {
              setEditing(null);
              void refresh();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
