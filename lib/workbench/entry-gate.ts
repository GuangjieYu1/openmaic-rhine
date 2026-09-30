import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { isAgentDriverReady } from '@/lib/workbench/driver-readiness';

/** Server-authoritative decision shared by every workbench entry route. */
export function isWorkbenchEntryEnabled(): boolean {
  return isProWorkbenchEnabled() && isAgentRuntimeConfigured() && isAgentDriverReady();
}
