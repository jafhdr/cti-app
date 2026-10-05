'use client';

import { createContext, useContext } from 'react';

export const CaseMutationAccessContext = createContext(false);
export const CaseTenantContext = createContext({ tenantId: '', ready: false, role: 'USER' });

export function useCaseMutationAccess(): boolean {
  return useContext(CaseMutationAccessContext);
}

export function useCaseTenant() {
  return useContext(CaseTenantContext);
}

export function caseWorkspaceUrl(url: string, role: string, tenantId: string): string {
  if (role !== 'SUPER_ADMIN') return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}
