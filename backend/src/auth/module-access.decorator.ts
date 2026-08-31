import { SetMetadata } from '@nestjs/common';

export const REQUIRED_MODULE_KEY = 'requiredModule';
export const RequiresModule = (slug: string) => SetMetadata(REQUIRED_MODULE_KEY, slug);
