import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { DiscoveryService } from "./discovery.service";
import { DiscoveryClient } from "./discovery.client";
import type { AuthUser } from "../users/users.types";
import { AssetType, AssetStatus } from "@prisma/client";

function mockDomainAsset(overrides: Record<string, any> = {}) {
  return {
    id: "asset-1", tenantId: "tenant-123", name: "example.com",
    type: AssetType.DOMAIN, value: "example.com", status: AssetStatus.UNKNOWN,
    criticality: "MEDIUM" as any, description: null, owner: null,
    firstSeenAt: null, lastSeenAt: null,
    createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("DiscoveryService", () => {
  let service: DiscoveryService, prisma: PrismaService, client: DiscoveryClient;

  const adminUser: AuthUser = { sub: "user-1", role: "ADMIN", tenantId: "tenant-123" }, otherUser: AuthUser = { sub: "user-2", role: "ADMIN", tenantId: "tenant-OTHER" };
  const superAdmin: AuthUser = { sub: "sa-1", role: "SUPER_ADMIN", tenantId: null };
  const userRole: AuthUser = { sub: "user-3", role: "USER", tenantId: "tenant-123" };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        { provide: PrismaService, useValue: { asset: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() }, assetRelationship: { upsert: jest.fn() }, tenant: { findUnique: jest.fn() }, auditLog: { create: jest.fn() } } },
        { provide: DiscoveryClient, useValue: { discoverViaDns: jest.fn(), discoverViaCertTransparency: jest.fn(), resolveDns: jest.fn(), isSubdomainOf: jest.fn(), isValidHostname: jest.fn() } },
      ],
    }).compile();
    service = module.get(DiscoveryService); prisma = module.get(PrismaService); client = module.get(DiscoveryClient);
    jest.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);
    jest.spyOn(client, "resolveDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostname: "example.com", ipv4: [], ipv6: [], cnames: [], errors: [] });
  });

  describe("1. Asset type validation", () => {
    it("throws BadRequestException when asset type is not DOMAIN", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset({ type: AssetType.IP_ADDRESS }));
      await expect(service.runDiscovery(adminUser, "asset-1")).rejects.toThrow(BadRequestException);
    });
    it("succeeds when asset type is DOMAIN", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: [] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.rootDomain).toBe("example.com");
    });
  });

  describe("2. Tenant isolation", () => {
    it("throws NotFoundException when asset not found for tenant", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(null);
      await expect(service.runDiscovery(adminUser, "asset-other")).rejects.toThrow(NotFoundException);
    });
  });

  describe("3. USER/ADMIN cannot discover another tenant asset", () => {
    it("ADMIN from tenant-OTHER cannot access tenant-123 asset", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(null);
      await expect(service.runDiscovery(otherUser, "asset-1")).rejects.toThrow(NotFoundException);
    });
    it("USER from own tenant can discover own asset", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: [] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(userRole, "asset-1");
      expect(result).toBeDefined();
    });
  });

  describe("4. Valid subdomains are accepted", () => {
    it("creates assets for valid subdomains", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce(null);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      jest.spyOn(prisma.asset, "create").mockResolvedValue({} as any);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.created).toBe(1);
    });
  });

  describe("5. External domains are rejected", () => {
    it("does not create assets for hostnames not subdomains of root", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["evil.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.discovered).toBe(0);
      expect(result.created).toBe(0);
    });
  });

  describe("6. Invalid hostnames are rejected", () => {
    it("does not create assets for invalid hostnames", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["--bad.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(false);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.discovered).toBe(0);
    });
  });

  describe("7. Duplicate results do not create duplicate assets", () => {
    it("deduplicates same hostname from multiple providers", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce(null);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      jest.spyOn(prisma.asset, "create").mockResolvedValue({} as any);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.discovered).toBe(1);
      expect(result.created).toBe(1);
      expect(prisma.asset.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("8. Existing asset is not created again", () => {
    it("updates lastSeenAt instead of creating when asset already exists", async () => {
      const firstSeen = new Date("2024-01-01");
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce({ id: "sub-1", firstSeenAt: firstSeen } as any);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      jest.spyOn(prisma.asset, "update").mockResolvedValue({} as any);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(prisma.asset.create).not.toHaveBeenCalled();
    });
  });

  describe("9. firstSeenAt is not changed on rediscovery", () => {
    it("update call does not include firstSeenAt", async () => {
      const firstSeen = new Date("2024-01-01");
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce({ id: "sub-1", firstSeenAt: firstSeen } as any);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      const spy9 = jest.spyOn(prisma.asset, "update").mockResolvedValue({} as any);
      await service.runDiscovery(adminUser, "asset-1");
      expect((spy9.mock.calls[0][0] as any).data).not.toHaveProperty("firstSeenAt");
    });
  });

  describe("10. lastSeenAt is updated on rediscovery", () => {
    it("update call includes lastSeenAt", async () => {
      const firstSeen = new Date("2024-01-01");
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce({ id: "sub-1", firstSeenAt: firstSeen } as any);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      const spy10 = jest.spyOn(prisma.asset, "update").mockResolvedValue({} as any);
      await service.runDiscovery(adminUser, "asset-1");
      expect((spy10.mock.calls[0][0] as any).data).toHaveProperty("lastSeenAt");
    });
  });

  describe("11. Provider timeout is handled gracefully", () => {
    it("continues if one provider times out", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockRejectedValue(new Error("Request timeout"));
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.discovered).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("12. Provider failure is handled gracefully", () => {
    it("returns result with errors when provider fails", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockRejectedValue(new Error("Network error"));
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [], error: "HTTP 503" });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result.discovered).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("13. Audit events are created", () => {
    it("creates ASSET_DISCOVERY_STARTED and ASSET_DISCOVERY_COMPLETED", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: [] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const auditSpy = jest.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);
      await service.runDiscovery(adminUser, "asset-1");
      const actions = auditSpy.mock.calls.map((c) => (c[0] as any).data.action);
      expect(actions).toContain("ASSET_DISCOVERY_STARTED");
      expect(actions).toContain("ASSET_DISCOVERY_COMPLETED");
    });
    it("audit events use tenantId from authenticated user context", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: [] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const auditSpy = jest.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);
      await service.runDiscovery(adminUser, "asset-1");
      for (const call of auditSpy.mock.calls) { expect((call[0] as any).data.tenantId).toBe("tenant-123"); }
    });
  });

  describe("14. Discovery response summary is correct", () => {
    it("returns all required summary fields", async () => {
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset()).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: ["api.example.com", "dev.example.com"] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: ["staging.example.com"] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(true);
      jest.spyOn(prisma.asset, "create").mockResolvedValue({} as any);
      const result = await service.runDiscovery(adminUser, "asset-1");
      expect(result).toHaveProperty("rootDomain", "example.com");
      expect(result).toHaveProperty("discovered");
      expect(result).toHaveProperty("created");
      expect(result).toHaveProperty("updated");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("providers");
      expect(result).toHaveProperty("errors");
    });
  });

  describe("SUPER_ADMIN tenant resolution", () => {
    it("SUPER_ADMIN without tenantId throws BadRequestException", async () => {
      await expect(service.runDiscovery(superAdmin, "asset-1", undefined)).rejects.toThrow(BadRequestException);
    });
    it("SUPER_ADMIN with valid tenantId resolves correctly", async () => {
      jest.spyOn(prisma.tenant, "findUnique").mockResolvedValue({ id: "tenant-123" } as any);
      jest.spyOn(prisma.asset, "findFirst").mockResolvedValueOnce(mockDomainAsset());
      jest.spyOn(client, "discoverViaDns").mockResolvedValue({ provider: "CLOUDFLARE_DOH", hostnames: [] });
      jest.spyOn(client, "discoverViaCertTransparency").mockResolvedValue({ provider: "CRTSH", hostnames: [] });
      jest.spyOn(client, "isValidHostname").mockReturnValue(true);
      jest.spyOn(client, "isSubdomainOf").mockReturnValue(false);
      const result = await service.runDiscovery(superAdmin, "asset-1", "tenant-123");
      expect(result).toBeDefined();
    });
  });

  describe("ForbiddenException for missing tenant context", () => {
    it("throws ForbiddenException when non-SA user has no tenantId", async () => {
      const noTenant: AuthUser = { sub: "u1", role: "ADMIN", tenantId: null };
      await expect(service.runDiscovery(noTenant, "asset-1")).rejects.toThrow(ForbiddenException);
    });
  });
});
