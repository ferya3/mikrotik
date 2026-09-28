'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await post('/auth/password', { currentPassword: current, newPassword: next });
      setMsg({ ok: true, text: 'Password changed. Other sessions were signed out.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs out every other session.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
          <Button type="submit">Change password</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setSetup(null);
      setCode('');
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication {me?.totpEnabled ? <Badge variant="success">enabled</Badge> : <Badge variant="warning">disabled</Badge>}
        </CardTitle>
        <CardDescription>Strongly recommended for every account that can change router configuration.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!me?.totpEnabled && !setup && (
          <Button onClick={async () => setSetup(await post<{ secret: string; qrDataUrl: string }>('/auth/2fa/setup'))}>Set up authenticator</Button>
        )}
        {setup && (
          <div className="space-y-3">
            <p className="text-sm">Scan with Google Authenticator, Aegis, 1Password… then enter the 6-digit code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="TOTP QR code" className="size-44 rounded bg-white p-2" />
            <p className="font-mono text-xs text-muted-foreground">{setup.secret}</p>
            <Input inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Button onClick={() => act(() => post('/auth/2fa/enable', { code }), '2FA enabled.')}>Verify & enable</Button>
          </div>
        )}
        {me?.totpEnabled && (
          <div className="space-y-3">
            <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input inputMode="numeric" maxLength={6} placeholder="Current code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Button variant="destructive" onClick={() => act(() => post('/auth/2fa/disable', { password, code }), '2FA disabled.')}>
              Disable 2FA
            </Button>
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  const { data: me } = useMe();
  return (
    <>
      <PageHeader title="My account" description={me ? `${me.username} · ${me.role}` : undefined} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordCard />
        <TwoFactorCard />
      </div>
    </>
  );
}
