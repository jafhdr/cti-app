export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export type AuthUser = {
  sub: string;
  tenantId: string | null;
  role: UserRole;
};