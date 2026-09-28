import type { RouterStatus } from '@prisma/client';

/** Latest poll result per router, stored in Redis and pushed over the WebSocket. */
export interface InterfaceLive {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  rxBps: number;
  txBps: number;
}

export interface RouterLive {
  routerId: string;
  status: RouterStatus;
  ts: number;
  error?: string;
  cpuLoad?: number;
  memUsed?: number;
  memTotal?: number;
  uptime?: string;
  temperature?: number | null;
  rxBps?: number;
  txBps?: number;
  pppActive?: number;
  interfaces?: InterfaceLive[];
}

export const liveKey = (routerId: string) => `nms:live:${routerId}`;
