import { AppSecFindingStatus } from '@prisma/client';

export function canTransition(from: AppSecFindingStatus, to: AppSecFindingStatus): boolean {
  switch (from) {
    case AppSecFindingStatus.OPEN:
      return to === AppSecFindingStatus.IN_PROGRESS || isTerminal(to);
    case AppSecFindingStatus.IN_PROGRESS:
      return to === AppSecFindingStatus.OPEN || isTerminal(to);
    case AppSecFindingStatus.RESOLVED:
    case AppSecFindingStatus.ACCEPTED_RISK:
    case AppSecFindingStatus.FALSE_POSITIVE:
      return to === AppSecFindingStatus.OPEN;
  }
}

export function isTerminal(status: AppSecFindingStatus): boolean {
  return status === AppSecFindingStatus.RESOLVED || status === AppSecFindingStatus.ACCEPTED_RISK || status === AppSecFindingStatus.FALSE_POSITIVE;
}
