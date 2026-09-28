'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Overview, RouterLive } from './types';

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    // Same origin in production (Nginx). In dev the Next rewrite cannot proxy WebSockets, so connect to the API directly.
    const origin = process.env.NEXT_PUBLIC_API_ORIGIN || undefined;
    socket = io(origin ?? '', { path: '/api/socket.io', withCredentials: true, transports: ['websocket'] });
  }
  return socket;
}

/**
 * Subscribes to real-time router snapshots and alert events, merging them into the React Query cache
 * so every view (dashboard, router page) updates without polling or manual refresh.
 */
export function useLiveUpdates() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const onLive = (live: RouterLive) => {
      qc.setQueryData<RouterLive>(['live', live.routerId], live);
      qc.setQueryData<Overview>(['overview'], (old) =>
        old
          ? {
              ...old,
              routers: old.routers.map((r) => (r.id === live.routerId ? { ...r, status: live.status, live } : r)),
            }
          : old,
      );
    };
    const onAlert = () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('router.live', onLive);
    s.on('alert.opened', onAlert);
    s.on('alert.resolved', onAlert);
    setConnected(s.connected);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('router.live', onLive);
      s.off('alert.opened', onAlert);
      s.off('alert.resolved', onAlert);
    };
  }, [qc]);

  return connected;
}
