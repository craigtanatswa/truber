import { AccountStatus } from '../domain';

export const ADMIN_SETTABLE_STATUSES: readonly AccountStatus[] = ['active', 'suspended', 'disabled'];

export function isAllowedAccountStatusTransition(from: AccountStatus, to: AccountStatus): boolean {
  return from !== to && ADMIN_SETTABLE_STATUSES.includes(to);
}

export function revokesSessions(to: AccountStatus): boolean {
  return to === 'suspended' || to === 'disabled';
}
