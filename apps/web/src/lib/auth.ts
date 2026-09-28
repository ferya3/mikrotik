'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { Me } from './types';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me'), staleTime: 60_000, retry: false });
}

/** UI-side permission check. Only hides controls — the API enforces every permission itself. */
export function useCan() {
  const { data } = useMe();
  const perms = new Set(data?.permissions ?? []);
  return (...anyOf: string[]) => anyOf.some((p) => perms.has(p));
}
