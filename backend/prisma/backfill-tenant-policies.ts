import { PrismaClient } from '@prisma/client';

/**
 * BLOCKER 1: Tenant Policy Backfill
 * 
 * Safe, idempotent backfill for old tenants without TenantModule and ModuleRoleAccess policies.
 * This addresses the ModuleAccessGuard requirement that all valid tenants must have policy records.
 * 
 * Strategy:
 * 1. Find all active tenants with active subscriptions
 * 2. For each tenant, get modules from their subscription
 * 3. Ensure TenantModule exists for each module (upsert with isEnabled=true)
 * 4. Ensure ModuleRoleAccess exists for ADMIN and USER roles (create with isAllowed=true)
 * 5. Skip tenants that already have policies (idempotent)
 */

const prisma = new PrismaClient();

async function backfillTenantPolicies() {
  console.log('[Backfill] Starting tenant policy backfill...');
  
  try {
    // Find all active tenants with active subscriptions
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      include: {
        subscription: {
          where: { status: { in: ['ACTIVE', 'TRIAL'] }, renewalAt: { gt: new Date() } },
          include: {
            package: { include: { modules: { include: { module: true } } } },
            customModules: { include: { module: true } },
          },
        },
      },
    });

    console.log(`[Backfill] Found ${tenants.length} active tenants to process`);

    for (const tenant of tenants) {
      if (!tenant.subscription) {
        console.log(`[Backfill] Tenant ${tenant.id} (${tenant.slug}) has no active subscription, skipping`);
        continue;
      }

      // Get modules for this tenant (from package or custom)
      const moduleIds = new Set<string>();
      
      if (tenant.subscription.package) {
        tenant.subscription.package.modules.forEach((pm) => {
          if (pm.module) moduleIds.add(pm.module.id);
        });
      }
      
      tenant.subscription.customModules.forEach((cm) => {
        if (cm.module) moduleIds.add(cm.module.id);
      });

      if (moduleIds.size === 0) {
        console.log(`[Backfill] Tenant ${tenant.id} (${tenant.slug}) has no modules in subscription`);
        continue;
      }

      console.log(`[Backfill] Processing tenant ${tenant.id} (${tenant.slug}) with ${moduleIds.size} modules`);

      // Backfill each module for this tenant
      for (const moduleId of moduleIds) {
        try {
          // Upsert TenantModule - idempotent
          const tenantModule = await prisma.tenantModule.upsert({
            where: { tenantId_moduleId: { tenantId: tenant.id, moduleId } },
            update: {}, // Don't change existing records
            create: {
              tenantId: tenant.id,
              moduleId,
              isEnabled: true,
            },
          });

          // Upsert ModuleRoleAccess for ADMIN and USER roles - idempotent
          for (const role of ['ADMIN', 'USER'] as const) {
            await prisma.moduleRoleAccess.upsert({
              where: { tenantModuleId_role: { tenantModuleId: tenantModule.id, role } },
              update: {}, // Don't change existing records
              create: {
                tenantModuleId: tenantModule.id,
                role,
                isAllowed: true,
              },
            });
          }

          console.log(`[Backfill]   ✓ Module ${moduleId} configured for tenant ${tenant.id}`);
        } catch (error) {
          console.error(`[Backfill]   ✗ Error processing module ${moduleId} for tenant ${tenant.id}:`, error);
        }
      }
    }

    console.log('[Backfill] Tenant policy backfill completed successfully');
  } catch (error) {
    console.error('[Backfill] Fatal error during backfill:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backfill
backfillTenantPolicies();
