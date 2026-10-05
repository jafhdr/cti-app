import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateUserDto, UpdateUserModuleAccessDto } from './users-boundary.dto';
import { CreateTenantDto, UpdateTenantStatusDto } from '../tenants/tenants.dto';
import { AssignCaseInput, ListCaseQuery } from '../cases/cases.types';

describe('sensitive request validation', () => {
  it('rejects malformed nested feature grants', () => {
    const input = plainToInstance(UpdateUserModuleAccessDto, { access: [{ moduleId: 12, featureKeys: ['case-workflow', 7] }] });
    expect(validateSync(input)).not.toHaveLength(0);
  });

  it('rejects invalid user and tenant creation payloads', () => {
    expect(validateSync(plainToInstance(CreateUserDto, { name: 'A', email: 'bad', password: 'short', role: 'ROOT' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(CreateTenantDto, { name: 'Tenant', slug: '../bad', adminName: 'A', adminEmail: 'bad', adminPassword: 'short' }))).not.toHaveLength(0);
  });

  it('rejects string status and empty assignment IDs', () => {
    expect(validateSync(plainToInstance(UpdateTenantStatusDto, { isActive: 'false' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(AssignCaseInput, { assigneeId: '' }))).not.toHaveLength(0);
  });

  it('parses bounded Case pagination and tenant query', () => {
    const valid = plainToInstance(ListCaseQuery, { page: '2', limit: '25', tenantId: 'tenant-a' });
    expect(validateSync(valid)).toHaveLength(0);
    expect(valid.page).toBe(2);
    expect(validateSync(plainToInstance(ListCaseQuery, { page: '0', limit: '101' }))).not.toHaveLength(0);
  });
});
