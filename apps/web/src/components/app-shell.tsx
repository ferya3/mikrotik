'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Router,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { useLiveUpdates } from '@/lib/live';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'monitoring:read' },
  { href: '/routers', label: 'Routers', icon: Router, perm: 'router:read' },
  { href: '/groups', label: 'Groups & Bulk', icon: FolderTree, perm: 'router:read' },
  { href: '/alerts', label: 'Alerts', icon: Bell, perm: 'alert:read' },
  { href: '/audit', label: 'Audit Log', icon: ScrollText, perm: 'audit:read' },
  { href: '/users', label: 'Users & Roles', icon: Users, perm: 'user:read' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe();
  const can = useCan();
  const connected = useLiveUpdates();

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  if (isLoading || !me) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <ShieldCheck className="size-5 text-primary" />
          <span className="font-semibold">Network Manager</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                pathname.startsWith(n.href)
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <span className={cn('size-2 rounded-full', connected ? 'bg-success' : 'bg-destructive')} />
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
          <Link href="/account" className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent">
            <UserCog className="size-4" />
            <span className="truncate">
              {me.username} <span className="text-muted-foreground">· {me.role.replace('_', ' ')}</span>
            </span>
          </Link>
          <button onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded px-1 py-1 text-muted-foreground hover:bg-accent">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <ShieldCheck className="size-5 text-primary" />
          <nav className="flex gap-3 overflow-x-auto text-sm">
            {NAV.filter((n) => can(n.perm)).map((n) => (
              <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'font-medium' : 'text-muted-foreground'}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
