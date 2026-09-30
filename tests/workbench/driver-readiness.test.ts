import { afterEach, describe, expect, it } from 'vitest';
import { isAgentDriverReady } from '@/lib/workbench/driver-readiness';

const oldRoute = process.env.MODEL_ROUTES;
const oldKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  if (oldRoute === undefined) delete process.env.MODEL_ROUTES;
  else process.env.MODEL_ROUTES = oldRoute;
  if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = oldKey;
});

describe('agent driver readiness', () => {
  it('refuses malformed or unconfigured routes', () => {
    process.env.MODEL_ROUTES = '{}';
    expect(isAgentDriverReady()).toBe(false);
    process.env.MODEL_ROUTES = '{"maic-agent-driver":{"model":"deepseek:deepseek-v4-flash"}}';
    expect(isAgentDriverReady()).toBe(false);
  });
  it('keeps the cloud entry closed until a real key is present', () => {
    process.env.MODEL_ROUTES = '{"maic-agent-driver":{"model":"deepseek:deepseek-v4-flash","api":"openai-completions"}}';
    delete process.env.DEEPSEEK_API_KEY;
    expect(isAgentDriverReady()).toBe(false);
    process.env.DEEPSEEK_API_KEY = 'local-test-key';
    expect(isAgentDriverReady()).toBe(true);
  });
});
