'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError, post } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { username, password, ...(needs2fa ? { totp } : {}) });
      const next = params.get('next');
      // Only allow local paths as redirect targets.
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { requires2fa?: boolean } | undefined) : undefined;
      if (body?.requires2fa) {
        setNeeds2fa(true);
        setError(null);
      } else {
        setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts, wait a minute.' : (err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full max-w-sm p-6">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck className="size-6 text-primary" />
        <div>
          <h1 className="font-semibold">Network Manager</h1>
          <p className="text-xs text-muted-foreground">MikroTik RouterOS management</p>
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={needs2fa} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={needs2fa}
          />
        </div>
        {needs2fa && (
          <div className="space-y-1.5">
            <Label htmlFor="totp">Authenticator code</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : needs2fa ? 'Verify' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
