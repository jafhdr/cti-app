import { SetMetadata } from '@nestjs/common';

export const REQUIRED_MODULE_KEY = 'requiredModule';
export const RequiresModule = (slug: string) => SetMetadata(REQUIRED_MODULE_KEY, slug);

export const REQUIRED_FEATURE_KEY = 'requiredFeatures';
export const RequiresModuleFeature = (...keys: readonly string[]) => SetMetadata(REQUIRED_FEATURE_KEY, keys);
