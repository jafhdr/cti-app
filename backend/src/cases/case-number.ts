import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export async function allocateCaseNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
  if (tenant.length !== 1) throw new NotFoundException('Tenant tidak ditemukan');
  const prefix = `CASE-${new Date().getFullYear()}-`;
  const rows = await tx.$queryRaw<Array<{ number: bigint }>>`
    SELECT COALESCE(MAX(SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1)::bigint), 0)::bigint AS number
    FROM "Case"
    WHERE "tenantId" = ${tenantId} AND "caseNumber" LIKE ${`${prefix}%`}
      AND SUBSTRING("caseNumber" FROM LENGTH(${prefix}) + 1) ~ '^[0-9]+$'`;
  const next = BigInt(rows[0]?.number ?? 0n) + 1n;
  return `${prefix}${next.toString().padStart(5, '0')}`;
}
