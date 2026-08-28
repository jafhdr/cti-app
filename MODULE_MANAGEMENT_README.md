# Module Management - Super Admin Feature

## Overview
Fitur Module Management untuk Super Admin yang mencakup seluruh aspek manajemen modul aplikasi CTI.

## Database Schema Changes

### New Enums
- `ModuleStatus`: ACTIVE, INACTIVE, BETA, DEPRECATED
- `SubscriptionPlan`: FREE, STANDARD, PRO, ENTERPRISE

### New Models

#### 1. Module
- Menyimpan daftar seluruh modul aplikasi (CTI Source, Indicator, Threat Actor, dll)
- Fields: id, name, code, description, version, status, isGlobalEnabled, config

#### 2. ModuleEntitlement
- Mengatur modul mana yang tersedia untuk paket subscription tertentu
- Fields: id, moduleId, plan, isEnabled, quotaLimit, quotaUsed

#### 3. TenantModule
- Assign modul ke tenant tertentu secara manual
- Fields: id, tenantId, moduleId, isEnabled, isOverride, overrideReason, featureFlags, config

#### 4. ModuleAuditLog
- Log perubahan modul (siapa mengaktifkan, mengubah entitlement, dll)
- Fields: id, moduleId, userId, tenantId, action, metadata

#### 5. ModuleHealth
- Monitoring status modul (up/down, error rate, latency, dll)
- Fields: id, moduleId, status, errorRate, latency, queueBacklog, failureCount

#### 6. GlobalModuleConfig
- Konfigurasi global modul (provider enrichment, TAXII server, dll)
- Fields: id, key, value, moduleId

## API Endpoints

Semua endpoint memerlukan role **SUPER_ADMIN**.

### Global Module Catalog
```
GET /modules
GET /modules/:id
```

### Create / Edit / Delete Module
```
POST /modules              - Create modul baru
PUT /modules/:id           - Update modul
DELETE /modules/:id        - Delete modul
```

### Enable / Disable Module Globally
```
POST /modules/:id/toggle-global  - Toggle status global modul
Body: { isEnabled: boolean }
```

### Module Entitlement per Plan
```
POST /modules/entitlements       - Create entitlement
PUT /modules/entitlements/:id    - Update entitlement
DELETE /modules/entitlements/:id - Delete entitlement
```

### Assign Module to Tenant
```
POST /modules/assign                          - Assign modul ke tenant
PUT /modules/tenants/:tenantId/modules/:moduleId         - Update config modul tenant
DELETE /modules/tenants/:tenantId/modules/:moduleId      - Remove modul dari tenant
POST /modules/tenants/:tenantId/modules/:moduleId/override - Override akses modul tenant
```

### Global Module Configuration
```
POST /modules/config        - Create global config
PUT /modules/config/:key    - Update global config
GET /modules/config         - Get all global configs
```

### Module Health Monitoring
```
POST /modules/health  - Update health status modul
GET /modules/health   - Get health status semua modul
```

### Global Usage Monitoring
```
GET /modules/usage              - Get usage monitoring global
GET /modules/usage?tenantId=xxx - Get usage monitoring per tenant
```

### Global Audit Log
```
GET /modules/audit-logs                - Get audit logs modules
GET /modules/audit-logs?moduleId=xxx   - Get audit logs per modul
```

## Example Usage

### 1. Create Module Baru
```json
POST /modules
{
  "name": "CVE Intelligence",
  "code": "cve_intelligence",
  "description": "Modul untuk intelligence CVE dan vulnerability tracking",
  "version": "1.0.0",
  "status": "ACTIVE",
  "isGlobalEnabled": true
}
```

### 2. Set Entitlement per Subscription Plan
```json
POST /modules/entitlements
{
  "moduleId": "module_id_here",
  "plan": "ENTERPRISE",
  "isEnabled": true,
  "quotaLimit": 10000
}
```

### 3. Assign Module ke Tenant Specific
```json
POST /modules/assign
{
  "tenantId": "tenant_id_here",
  "moduleId": "module_id_here",
  "isEnabled": true,
  "featureFlags": {
    "beta_feature": true,
    "experimental": false
  },
  "config": {
    "custom_provider": "custom-value"
  }
}
```

### 4. Override Akses Modul untuk Tenant
```json
POST /modules/tenants/:tenantId/modules/:moduleId/override
{
  "isEnabled": true,
  "reason": "Incident response requirement - temporary access for security team"
}
```

### 5. Update Global Config
```json
POST /modules/config
{
  "key": "enrichment_provider",
  "value": {
    "provider": "virustotal",
    "api_endpoint": "https://api.virustotal.com/api/v3",
    "rate_limit": 4
  },
  "moduleId": "module_id_here"
}
```

### 6. Update Module Health
```json
POST /modules/health
{
  "moduleId": "module_id_here",
  "status": "healthy",
  "errorRate": 0.01,
  "latency": 150,
  "queueBacklog": 5,
  "failureCount": 0,
  "metadata": {
    "last_successful_run": "2025-01-15T10:30:00Z"
  }
}
```

## Fitur yang Diimplementasikan

| Fitur | Status | Endpoint |
|-------|--------|----------|
| Global Module Catalog | ✅ | GET /modules |
| Create / Edit / Delete Module | ✅ | POST/PUT/DELETE /modules |
| Enable / Disable Module Globally | ✅ | POST /modules/:id/toggle-global |
| Feature Flag Management | ✅ | Via TenantModule.featureFlags |
| Module Entitlement per Plan | ✅ | POST/PUT/DELETE /modules/entitlements |
| Assign Module to Tenant | ✅ | POST /modules/assign |
| Global Module Configuration | ✅ | POST/PUT/GET /modules/config |
| Global Usage Monitoring | ✅ | GET /modules/usage |
| Global Audit Log | ✅ | GET /modules/audit-logs |
| Module Health Monitoring | ✅ | POST/GET /modules/health |
| Tenant Override | ✅ | POST /modules/tenants/:tenantId/modules/:moduleId/override |

## Migration Database

Untuk menerapkan schema baru ke database:

```bash
cd backend
npx prisma migrate dev --name add_module_management
```

## Seed Data (Optional)

Anda dapat menambahkan seed data untuk modul default di `prisma/seed.ts`:

```typescript
await prisma.module.createMany({
  data: [
    { name: 'CTI Source', code: 'cti_source', description: 'Source management for CTI' },
    { name: 'Indicator', code: 'indicator', description: 'Indicator management' },
    { name: 'Threat Actor', code: 'threat_actor', description: 'Threat actor tracking' },
    { name: 'Campaign', code: 'campaign', description: 'Campaign management' },
    { name: 'MITRE ATT&CK', code: 'mitre_attack', description: 'MITRE ATT&CK mapping' },
    { name: 'Case Management', code: 'case_management', description: 'Case management system' },
    { name: 'Alerting', code: 'alerting', description: 'Alert notification system' },
    { name: 'Search', code: 'search', description: 'Global search functionality' },
    { name: 'Enrichment', code: 'enrichment', description: 'Data enrichment provider' },
    { name: 'CVE Intelligence', code: 'cve_intelligence', description: 'CVE intelligence tracking' },
    { name: 'API Integration', code: 'api_integration', description: 'External API integrations' },
    { name: 'Subscription', code: 'subscription', description: 'Subscription management' },
    { name: 'Audit Log', code: 'audit_log', description: 'System audit logging' },
  ]
});
```
