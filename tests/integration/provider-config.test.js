import assert from "node:assert/strict";
import { defaultProviderConfig, hasRequiredProviderConfig } from "../../src/providers/ai-tu-provider-adapter.js";

const config = defaultProviderConfig();
const hasProvider = hasRequiredProviderConfig(config);

if (!hasProvider) {
  console.log("BLOCKED_BY_MISSING_PROVIDER_CONFIG: provider base URL, model, and key configuration are required for real provider integration.");
  process.exit(0);
}

assert.match(config.baseUrl, /^https?:\/\//);
assert.ok(config.model);
assert.ok(hasRequiredProviderConfig(config));
console.log("REAL_PROVIDER_CONFIG_PRESENT");
