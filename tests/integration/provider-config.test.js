import assert from "node:assert/strict";
import { defaultProviderConfig, hasRequiredProviderConfig } from "../../src/providers/ai-tu-provider-adapter.js";

const config = defaultProviderConfig();
const hasProvider = hasRequiredProviderConfig(config);

if (!hasProvider) {
  console.log("BLOCKED_BY_MISSING_PROVIDER_CONFIG: provider generations endpoint, edits endpoint, and key configuration are required for real provider integration.");
  process.exit(0);
}

assert.match(config.baseUrl, /^https?:\/\/.+\/v1\/images\/generations$/);
assert.match(config.imageEditUrl, /^https?:\/\//);
assert.equal(config.model, "gpt-image-2");
assert.equal(config.imageModel, "gpt-image-2");
assert.equal(JSON.stringify(config).includes("gpt-image-2-all"), false);
assert.equal(JSON.stringify(config).includes("gpt-image-1"), false);
assert.equal(/dall-e-/i.test(JSON.stringify(config)), false);
assert.ok(hasRequiredProviderConfig(config));
console.log("REAL_PROVIDER_CONFIG_PRESENT");
