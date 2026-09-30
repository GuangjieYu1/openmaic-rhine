import { getProvider } from '@/lib/ai/providers';
import { LLM_ENV_MAP, resolveApiKey } from '@/lib/server/provider-config';
import type { ProviderId } from '@/lib/types/provider';

/** A database alone cannot make the authoring chat usable. Check its model route too. */
export function isAgentDriverReady(): boolean {
  try {
    const routes = JSON.parse(process.env.MODEL_ROUTES ?? '{}') as Record<string, unknown>;
    const route = routes['maic-agent-driver'];
    if (!route || typeof route !== 'object' || Array.isArray(route)) return false;
    const { model, api, dialect } = route as Record<string, unknown>;
    if (typeof model !== 'string' || !/^[a-z][a-z0-9_-]*:.+$/i.test(model)) return false;
    if (!['openai-completions', 'openai-responses'].includes(String(api ?? dialect))) return false;
    const providerId = model.slice(0, model.indexOf(':'));
    const provider = getProvider(providerId as ProviderId);
    if (!provider) return false;
    if (!provider.requiresApiKey) return true;
    // The provider config is cached per process; the raw operator env is also
    // checked so readiness is accurate in config tests and on a cold boot.
    const envPrefix = Object.entries(LLM_ENV_MAP).find(([, id]) => id === providerId)?.[0];
    const envKey = envPrefix ? process.env[`${envPrefix}_API_KEY`]?.trim() : '';
    return !!(resolveApiKey(providerId).trim() || envKey);
  } catch {
    return false;
  }
}
