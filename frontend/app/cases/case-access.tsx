'use client';

import { createContext, useContext } from 'react';

export const CaseMutationAccessContext = createContext(false);

export function useCaseMutationAccess(): boolean {
  return useContext(CaseMutationAccessContext);
}
