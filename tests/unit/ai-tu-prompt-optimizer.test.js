import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPromptOptimizationResponse,
  buildReferencePlan,
  callRagflowPromptOptimizer,
  handlePromptOptimization,
  parseRagflowOptimizedPrompt,
  ragflowConfig,
  validateRagflowEnhancement
} from "../../src/routes/prompt-optimizations.js";
import { containsHighConfidenceSensitivePayload, normalizeTextForSensitiveScan } from "../../src/core/sensitive-payload.js";

test("buildReferencePlan separates reference classes and generation_mode", () => {
  const refs = [
    reference("ref_scene", "古巷", "scene", "scene_reference"),
    reference("ref_char", "行人", "character", "character_reference"),
    reference("ref_light", "黄昏逆光", "lighting", "lighting_reference"),
    reference("ref_comp", "对称构图", "composition", "composition_reference")
  ];
  const plan = buildReferencePlan({
    resolved_references: refs,
    entity_mentions: [{ entity_name: "行人", reference_status: "bound" }]
  });
  assert.equal(plan.generationMode, "image_to_image");
  assert.equal(plan.sceneRefs[0].entity_name, "古巷");
  assert.equal(plan.characterRefs[0].entity_name, "行人");
  assert.equal(plan.lightingRefs[0].entity_name, "黄昏逆光");
  assert.equal(plan.compositionRefs[0].entity_name, "对称构图");
  assert.deepEqual(plan.allEntityNames, ["古巷", "行人", "黄昏逆光", "对称构图"]);
});

test("six task_type requests compile deterministic optimized prompts", async () => {
  const cases = [
    {
      task_type: "text_image",
      prompt: "一座雨夜霓虹街角的电影感画面",
      references: [],
      assertPrompt: assertTextImagePrompt,
      generation_mode: "text_to_image"
    },
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference("ref_poster", "海报参考", "style", "style_reference")],
      assertPrompt: (prompt) => assertImageReferencePrompt(prompt, ["海报参考"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "character_multiview",
      prompt: "生成 @云岚 的角色一致性参考图",
      references: [reference("ref_char", "云岚", "character", "character_reference")],
      assertPrompt: (prompt) => assertCharacterPrompt(prompt, "云岚"),
      generation_mode: "image_to_image"
    },
    {
      task_type: "scene_multiview",
      prompt: "生成 @茶馆 与 @掌柜 的现场光影多视角参考图",
      references: [
        reference("ref_scene", "茶馆", "scene", "scene_reference"),
        reference("ref_char", "掌柜", "character", "character_reference")
      ],
      assertPrompt: (prompt) => assertScenePrompt(prompt, ["茶馆", "掌柜"]),
      generation_mode: "image_to_image"
    },
    {
      task_type: "prop_multiview",
      prompt: "生成 @铜铃 的结构和材质多角度资产图",
      references: [reference("ref_prop", "铜铃", "prop", "prop_reference")],
      assertPrompt: (prompt) => assertPropPrompt(prompt, "铜铃"),
      generation_mode: "image_to_image"
    },
    {
      task_type: "storyboard",
      prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
      references: [],
      assertPrompt: assertStoryboardPrompt,
      generation_mode: "text_to_image"
    }
  ];

  for (const item of cases) {
    const result = await handlePromptOptimization({
      task_type: item.task_type,
      prompt: item.prompt,
      references: item.references,
      reference_policy: { unbound_entity: "warn" }
    }, offlineOptions());
    assert.equal(result.statusCode, 200, item.task_type);
    assert.equal(result.payload.status, "succeeded", item.task_type);
    assert.equal(result.payload.task_type, item.task_type);
    assert.equal(result.payload.generation_mode, item.generation_mode);
    assert.match(result.payload.optimization_id, /^opt_/);
    item.assertPrompt(result.payload.optimized_prompt);
    assertNoPromptLeaks(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  }
});

test("PromptOptimizationRequest schema rejects unknown and nested unsafe fields", async () => {
  const cases = [
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", output: { provider_payload: "x" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", callback: "https://client.example.com/cb" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", model: "gpt-image-2" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", provider_config: { api_key: "test" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", provider_options: { model: "gpt-image-2" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", api_key: "test-key" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", token: "test-token" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", compiled_prompt: "secret compiled prompt" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", internal_prompt: "secret internal prompt" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", base64: "abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", b64_json: "abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", data_url: "data:image/png;base64,abc" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", metadata: { topic: "x" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", options: { safe: true } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", extra: {} },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", context: {} },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", headers: null },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", authorization: false },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", "final-prompt": null },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", Final_Prompt: false },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", "ｆｉｎａｌ＿ｐｒｏｍｐｔ": 0 },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", apiKey: "" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", "proxy-authorization": "" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", "image-url": "" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", baseUrl: "" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", images: [{ url: "https://example.com/x.png" }] },
    { request_id: { value: "req_bad" }, task_type: "text_image", prompt: "生成一张山间晨雾图。" },
    { request_id: "req bad space", task_type: "text_image", prompt: "生成一张山间晨雾图。" },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: { value: "warn" } } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: "ignore" } },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", references: [reference("ref_scene", "山雾", "scene", "scene_reference", "https://example.com/ref.png", "场景参考", { provider_payload: "x" })] },
    { task_type: "text_image", prompt: "生成一张山间晨雾图。", reference_policy: { unbound_entity: "warn", callback: "https://client.example.com/cb" } },
    { task_type: "image_reference", references: [reference("ref_scene", "山雾", "scene", "scene_reference", "https://example.com/ref.png", "场景参考", { provider_payload: "x" })] },
    { task_type: "text_image", reference_policy: { unbound_entity: "warn", callback: "https://client.example.com/cb" } }
  ];
  for (const body of cases) {
    const result = await handlePromptOptimization(body, offlineOptions());
    assert.equal(result.statusCode, 400, JSON.stringify(body));
    assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
    assert.equal("optimized_prompt" in result.payload, false);
    assertNoPublicLeaks(result.payload);
  }

  const nullPrototypeBody = Object.create(null);
  nullPrototypeBody.task_type = "text_image";
  nullPrototypeBody.prompt = "生成一张山间晨雾图。";
  const nullPrototypeResult = await handlePromptOptimization(nullPrototypeBody, offlineOptions());
  assert.equal(nullPrototypeResult.statusCode, 400);
  assert.equal(nullPrototypeResult.payload.error_code, "INVALID_REQUEST_SCHEMA");
});

test("prompt optimizer accepts ordinary natural-language security vocabulary", async () => {
  const legalText = "secret garden 的 cookie 包装、token of friendship、Bearer token 流程图、base64 教学图、Authorization header 说明、Authorization: Bearer <token> 的语法说明、Authorization: Bearer YOUR_ACCESS_TOKEN_PLACEHOLDER 是占位格式、Bearer YOUR_ACCESS_TOKEN_PLACEHOLDER 是占位格式、Proxy-Authorization 教学、Cookie: session=value 是教学示例、Cookie: flavor=choco 是产品文案、cookie=YOUR_SESSION_COOKIE 是占位格式、api_key=YOUR_API_KEY 和 client_secret=\"YOUR_CLIENT_SECRET\" 是占位格式、final_prompt 命名规范、compiled_prompt 说明、provider payload 流程图、b64_json 和 data_url 教学";
  const textResult = await handlePromptOptimization({
    task_type: "text_image",
    prompt: `生成一张用于课程封面的画面：${legalText}`,
    references: []
  }, noRagflowOptions());
  assert.equal(textResult.statusCode, 200);
  assert.equal(textResult.payload.status, "succeeded");
  assert.match(textResult.payload.optimized_prompt, /secret garden|token of friendship|Authorization: Bearer <token>|YOUR_ACCESS_TOKEN_PLACEHOLDER|Cookie: session=value|Cookie: flavor=choco|YOUR_SESSION_COOKIE|YOUR_API_KEY|provider payload|b64_json|data_url/);
  assertNoPromptLeaks(textResult.payload.optimized_prompt);
  assertNoPublicLeaks(textResult.payload);

  const referenceResult = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @包装参考 生成一张安全培训海报",
    references: [reference(
      "ref_packaging",
      "包装参考",
      "style",
      "style_reference",
      "https://example.com/ref_packaging.png",
      `${legalText}，这些词只作为 reference metadata 的教学主题`
    )]
  }, noRagflowOptions());
  assert.equal(referenceResult.statusCode, 200);
  assert.equal(referenceResult.payload.status, "succeeded");
  assert.match(referenceResult.payload.optimized_prompt, /Bearer token 流程图|YOUR_ACCESS_TOKEN_PLACEHOLDER|Cookie: session=value|Cookie: flavor=choco|YOUR_SESSION_COOKIE|YOUR_API_KEY|provider payload|b64_json|data_url/);
  assertNoPromptLeaks(referenceResult.payload.optimized_prompt);
  assertNoPublicLeaks(referenceResult.payload);

  const colonCopyResult = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "生成一张奇幻仪表盘海报：secret: a hidden door in a castle garden；token: a brass coin on a velvet table；api_key: visual label for dashboard field。",
    references: []
  }, noRagflowOptions());
  assert.equal(colonCopyResult.statusCode, 200);
  assert.equal(colonCopyResult.payload.status, "succeeded");
  assert.match(colonCopyResult.payload.optimized_prompt, /hidden door|brass coin|dashboard field/);
  assertNoPromptLeaks(colonCopyResult.payload.optimized_prompt);
  assertNoPublicLeaks(colonCopyResult.payload);
});

test("prompt optimizer rejects authorization credentials hidden by default-ignorable characters before RAGFlow fetch", async () => {
  const apiKeyValue = "synthetic_credential_123456789";
  const proxyValue = "synthetic_proxy_credential_123456789";
  const cases = [
    ["word joiner", `Authori\u2060zation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["soft hyphen", `Authori\u00ADzation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["combining grapheme joiner", `Authori\u034Fzation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["mongolian vowel separator", `Authori\u180Ezation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["arabic letter mark", `Authori\u061Czation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["hangul choseong filler", `Authori\u115Fzation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["left-to-right mark", `Authori\u200Ezation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["right-to-left mark", `Authori\u200Fzation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["bidi embedding", `Authori\u202Azation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["bidi isolate", `Authori\u2066zation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["variation selector", `Authori\uFE0Fzation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["variation selector start", `Authori\uFE00zation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["supplementary variation selector", `Authori\u{E0100}zation: ApiKey ${apiKeyValue}`, apiKeyValue],
    ["multiple invisible controls", `Pro\u2060xy\u00AD-\u034FAuthori\u180Ezation: Custom ${proxyValue}`, proxyValue],
    ["fullwidth header and colon", `Ａｕｔｈｏｒｉｚａｔｉｏｎ： ApiKey ${apiKeyValue}`, apiKeyValue],
    ["fullwidth assignment punctuation", `ｐｒｏｘｙ＿ａｕｔｈｏｒｉｚａｔｉｏｎ＝Custom ${proxyValue}`, proxyValue]
  ];

  for (const [label, prompt, leaked] of cases) {
    await assertPromptOptimizerRejectsBeforeRagflow({
      label,
      body: { task_type: "text_image", prompt, references: [] },
      leaked
    });
  }
});

test("scanner normalization helper preserves originals and builds bounded scan copies", () => {
  const invisibleControls = [
    "\u00AD",
    "\u034F",
    "\u061C",
    "\u115F",
    "\u180E",
    "\u200B",
    "\u200C",
    "\u200D",
    "\u200E",
    "\u200F",
    "\u202A",
    "\u202B",
    "\u202C",
    "\u202D",
    "\u202E",
    "\u2060",
    "\u2061",
    "\u2062",
    "\u2063",
    "\u2064",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
    "\u206F",
    "\uFE00",
    "\uFE0F",
    "\uFEFF"
  ];
  const original = `Ａｕｔｈｏｒｉ${invisibleControls.join("")}\u{E0100}ｚａｔｉｏｎ： ApiKey synthetic_credential_123456789`;
  const scanCopy = normalizeTextForSensitiveScan(original);
  assert.notEqual(original, scanCopy);
  assert.match(original, /Ａｕｔｈｏｒｉ/);
  assert.equal(scanCopy, "Authorization: ApiKey synthetic_credential_123456789");
  for (const char of invisibleControls) {
    assert.equal(scanCopy.includes(char), false, char.codePointAt(0).toString(16));
  }
  assert.equal(containsHighConfidenceSensitivePayload(original), true);
  assert.equal(containsHighConfidenceSensitivePayload("Authorization header 工作原理和 assignment 解析说明"), false);

  const longInput = `Authorization=${"A".repeat(4097)}`;
  const started = Date.now();
  assert.equal(containsHighConfidenceSensitivePayload(longInput), true);
  assert.equal(Date.now() - started < 250, true);
});

test("prompt optimizer rejects complete authorization assignment values with comma and semicolon parameters", async () => {
  const cases = [
    {
      label: "digest response after comma",
      prompt: "authorization=Digest nc=1, response=\"synthetic_response_123456789\"",
      leaked: "synthetic_response_123456789"
    },
    {
      label: "digest response after quoted comma",
      prompt: "authorization=Digest r=\"x,y\", response=\"synthetic_response_123456789\"",
      leaked: "synthetic_response_123456789"
    },
    {
      label: "aws credential and signature after comma",
      prompt: "authorization=AWS4-HMAC-SHA256 Credential=synthetic/20260101/region/service/aws4_request, Signature=synthetic_signature_123456",
      leaked: "synthetic_signature_123456"
    },
    {
      label: "custom credential after semicolon",
      prompt: "proxy_authorization=Custom realm=\"x\"; credential=\"synthetic_credential_123456789\"",
      leaked: "synthetic_credential_123456789"
    },
    {
      label: "kebab proxy authorization assignment",
      prompt: "proxy-authorization=Token realm=\"x\"; token=\"synthetic_token_123456789\"",
      leaked: "synthetic_token_123456789"
    },
    {
      label: "escaped quoted assignment",
      prompt: "authorization=\"Custom realm=\\\"x\\\"; signature=\\\"synthetic_signature_123456789\\\"\"",
      leaked: "synthetic_signature_123456789"
    },
    {
      label: "malformed quote still scans current logical value",
      prompt: "authorization=\"Custom realm=\\\"x\\\"; signature=\\\"synthetic_signature_123456789",
      leaked: "synthetic_signature_123456789"
    }
  ];

  for (const { label, prompt, leaked } of cases) {
    await assertPromptOptimizerRejectsBeforeRagflow({
      label,
      body: { task_type: "text_image", prompt, references: [] },
      leaked
    });
  }

  await assertPromptOptimizerRejectsBeforeRagflow({
    label: "oversized authorization assignment",
    body: {
      task_type: "text_image",
      prompt: `authorization=${"A".repeat(4097)}`,
      references: []
    },
    leaked: "AAAAAAAAAAAAAAAA"
  });
});

test("prompt optimizer cookie detection allows low-risk preference copy and rejects credential cookies", async () => {
  const allowed = [
    "Cookie: flavor=choco",
    "请在标签上写 Cookie: flavor=choco",
    "Set-Cookie: theme=dark",
    "Cookie: language=zh-CN",
    "Cookie: theme=\"dark\"; layout=grid"
  ];
  for (const prompt of allowed) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: `生成一张包装标签，文字包括：${prompt}`,
      references: []
    }, noRagflowOptions());
    assert.equal(result.statusCode, 200, prompt);
    assert.equal(result.payload.status, "succeeded", prompt);
    assert.match(result.payload.optimized_prompt, /flavor=choco|theme="?dark"?|language=zh-CN/, prompt);
    assertNoPublicLeaks(result.payload);
  }

  const referenceResult = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @包装参考 生成一张安全培训海报",
    references: [reference(
      "ref_packaging",
      "包装参考",
      "style",
      "style_reference",
      "https://example.com/ref_packaging.png",
      "reference metadata shows Cookie: flavor=choco and Set-Cookie: theme=dark"
    )]
  }, noRagflowOptions());
  assert.equal(referenceResult.statusCode, 200);
  assert.equal(referenceResult.payload.status, "succeeded");
  assert.match(referenceResult.payload.optimized_prompt, /flavor=choco|theme=dark/);
  assertNoPublicLeaks(referenceResult.payload);

  const highEntropySid = "N7xQp4rT9vLm2ZaB8cYd6EfGhJk3MnPq";
  const highEntropyPreference = "T7xQp4rT9vLm2ZaB8cYd6EfGhJk3MnPq";
  const rejected = [
    ["session cookie", "Cookie: sessionid=synthetic_session_123456789abcdef", "synthetic_session_123456789abcdef"],
    ["short session cookie", "Cookie: sessionid=abc", "sessionid=abc"],
    ["auth token cookie", "Cookie: auth_token=synthetic_auth_token_123456789", "synthetic_auth_token_123456789"],
    ["short auth token cookie", "Cookie: auth_token=abc", "auth_token=abc"],
    ["access token set-cookie", "Set-Cookie: access_token=synthetic_access_token_123456789; HttpOnly", "synthetic_access_token_123456789"],
    ["short access token set-cookie", "Set-Cookie: access_token=abc; HttpOnly", "access_token=abc"],
    ["short jwt cookie", "Cookie: jwt=abc", "jwt=abc"],
    ["high entropy sid", `Cookie: sid=${highEntropySid}`, highEntropySid],
    ["short sid cookie", "Cookie: sid=abc", "sid=abc"],
    ["generic high entropy cookie", `Cookie: preference=${highEntropyPreference}`, highEntropyPreference],
    ["multi pair credential", "Cookie: flavor=choco; jwt=eyJsyntheticJwtHeader123456789.eyJsyntheticPayload123456789.syntheticSignature123456789", "eyJsyntheticJwtHeader123456789"],
    ["product copy cannot hide session cookie", "产品文案示例 Cookie: sessionid=synthetic_session_123456789abcdef", "synthetic_session_123456789abcdef"]
  ];
  for (const [label, prompt, leaked] of rejected) {
    await assertPromptOptimizerRejectsBeforeRagflow({
      label,
      body: { task_type: "text_image", prompt, references: [] },
      leaked
    });
  }
});

test("prompt optimizer rejects sensitive consumed strings before RAGFlow fetch", async () => {
  const cases = [
    {
      task_type: "image_reference",
      prompt: "基于 @海报参考 生成一张新的品牌视觉图",
      references: [reference(
        "ref_poster",
        "海报参考",
        "style",
        "style_reference",
        "https://example.com/ref_poster.png",
        `Authorization: Bearer tok_${"A".repeat(32)} data:image/png;base64,${samplePngBase64()}`
      )]
    }
  ];
  for (const body of cases) {
    let fetches = 0;
    const result = await handlePromptOptimization(body, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch with sensitive metadata");
      }
    });
    assert.equal(result.statusCode, 400, JSON.stringify(body));
    assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
    assert.equal(fetches, 0);
    assertNoPublicLeaks(result.payload);
  }
});

test("prompt optimizer rejects high-confidence credentials and data payloads before RAGFlow fetch without echo", async () => {
  const bearerValue = `tok_${"A".repeat(32)}`;
  const basicValue = Buffer.from("user:super-secret-password").toString("base64");
  const cookieValue = `session=sid_${"B".repeat(24)}`;
  const apiKeyValue = `key_${"C".repeat(32)}`;
  const tokenValue = `tok_${"D".repeat(32)}`;
  const proxyValue = `proxy_${"P".repeat(32)}`;
  const customSchemeValue = `custom:${"Q".repeat(16)}!@#$%^&*()`;
  const lowEntropySpecialAuthValue = `${"Q".repeat(16)}!@#$%^&*()`;
  const digestValue = `${"a".repeat(32)}`;
  const awsCredentialValue = `AKIA${"A".repeat(16)}/20260618/us-east-1/service/aws4_request`;
  const accessTokenValue = `access_${"G".repeat(32)}`;
  const clientSecretValue = `client_${"H".repeat(32)}:$!`;
  const passwordValue = `pass_${"I".repeat(32)}@:/`;
  const setCookieValue = `sid=sid_${"J".repeat(32)}; HttpOnly`;
  const standaloneKeyValue = `sk-proj-${"E".repeat(32)}`;
  const dataUriValue = `data:image/png;base64,${samplePngBase64()}`;
  const textDataUriValue = "data:text/plain;base64,abc";
  const rawBase64Value = samplePngBase64();
  const lowEntropyBase64Value = lowEntropyLongBase64();
  const cases = [
    {
      label: "long bearer authorization header",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: Bearer ${bearerValue}`, references: [] },
      leaked: bearerValue
    },
    {
      label: "basic authorization credential",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: Basic ${basicValue}`, references: [] },
      leaked: basicValue
    },
    {
      label: "apikey authorization scheme",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: ApiKey ${apiKeyValue}`, references: [] },
      leaked: apiKeyValue
    },
    {
      label: "token authorization scheme",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: Token ${tokenValue}`, references: [] },
      leaked: tokenValue
    },
    {
      label: "digest authorization response",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: Digest username="tester", response="${digestValue}"`, references: [] },
      leaked: digestValue
    },
    {
      label: "aws4 authorization credential",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: AWS4-HMAC-SHA256 Credential=${awsCredentialValue}, Signature=${"b".repeat(40)}`, references: [] },
      leaked: awsCredentialValue
    },
    {
      label: "custom authorization scheme",
      body: { task_type: "text_image", prompt: `请绘制 Authorization: X-Custom ${customSchemeValue}`, references: [] },
      leaked: customSchemeValue
    },
    {
      label: "fullwidth authorization header",
      body: { task_type: "text_image", prompt: `请绘制 Ａｕｔｈｏｒｉｚａｔｉｏｎ： Bearer ${bearerValue}`, references: [] },
      leaked: bearerValue
    },
    {
      label: "zero-width authorization header",
      body: { task_type: "text_image", prompt: `请绘制 Autho\u200brization: Bearer ${bearerValue}`, references: [] },
      leaked: bearerValue
    },
    {
      label: "proxy authorization scheme",
      body: { task_type: "text_image", prompt: `请绘制 Proxy-Authorization: Fancy ${proxyValue}`, references: [] },
      leaked: proxyValue
    },
    {
      label: "bidi proxy authorization assignment",
      body: { task_type: "text_image", prompt: `请绘制 Proxy-Authori\u202ezation＝Fancy ${proxyValue}`, references: [] },
      leaked: proxyValue
    },
    {
      label: "bare bearer credential",
      body: { task_type: "text_image", prompt: `请绘制 Bearer ${bearerValue}`, references: [] },
      leaked: bearerValue
    },
    {
      label: "bare basic credential",
      body: { task_type: "text_image", prompt: `请绘制 Basic ${basicValue}`, references: [] },
      leaked: basicValue
    },
    {
      label: "cookie header value",
      body: { task_type: "text_image", prompt: `请绘制 Cookie: ${cookieValue}`, references: [] },
      leaked: cookieValue
    },
    {
      label: "set-cookie header value",
      body: { task_type: "text_image", prompt: `请绘制 Set-Cookie: ${setCookieValue}`, references: [] },
      leaked: setCookieValue
    },
    {
      label: "cookie assignment value",
      body: { task_type: "text_image", prompt: `请绘制 cookie=${"F".repeat(24)}`, references: [] },
      leaked: "F".repeat(24)
    },
    {
      label: "standalone known provider key",
      body: { task_type: "text_image", prompt: `请绘制 ${standaloneKeyValue}`, references: [] },
      leaked: standaloneKeyValue
    },
    {
      label: "api key assignment",
      body: { task_type: "text_image", prompt: `api_key=${apiKeyValue}`, references: [] },
      leaked: apiKeyValue
    },
    {
      label: "token assignment",
      body: { task_type: "text_image", prompt: `token=${tokenValue}`, references: [] },
      leaked: tokenValue
    },
    {
      label: "quoted authorization assignment with special characters",
      body: { task_type: "text_image", prompt: `authorization="X-Custom ${customSchemeValue}"`, references: [] },
      leaked: customSchemeValue
    },
    {
      label: "quoted authorization assignment with low-entropy special characters",
      body: { task_type: "text_image", prompt: `authorization="X-Custom ${lowEntropySpecialAuthValue}"`, references: [] },
      leaked: lowEntropySpecialAuthValue
    },
    {
      label: "unquoted authorization assignment with rest of line credential",
      body: { task_type: "text_image", prompt: `authorization=X-Custom ${lowEntropySpecialAuthValue}`, references: [] },
      leaked: lowEntropySpecialAuthValue
    },
    {
      label: "fullwidth api key assignment",
      body: { task_type: "text_image", prompt: `ａｐｉ＿ｋｅｙ＝${apiKeyValue}`, references: [] },
      leaked: apiKeyValue
    },
    {
      label: "quoted proxy authorization assignment with low-entropy special characters",
      body: { task_type: "text_image", prompt: `proxy_authorization="Fancy ${lowEntropySpecialAuthValue}"`, references: [] },
      leaked: lowEntropySpecialAuthValue
    },
    {
      label: "access_token assignment",
      body: { task_type: "text_image", prompt: `access_token='${accessTokenValue}'`, references: [] },
      leaked: accessTokenValue
    },
    {
      label: "client_secret assignment",
      body: { task_type: "text_image", prompt: `client_secret="${clientSecretValue}"`, references: [] },
      leaked: clientSecretValue
    },
    {
      label: "password assignment",
      body: { task_type: "text_image", prompt: `password="${passwordValue}"`, references: [] },
      leaked: passwordValue
    },
    {
      label: "real image data URI",
      body: { task_type: "text_image", prompt: dataUriValue, references: [] },
      leaked: samplePngBase64()
    },
    {
      label: "real non-image data URI",
      body: { task_type: "text_image", prompt: textDataUriValue, references: [] },
      leaked: textDataUriValue
    },
    {
      label: "synthetic short data URI before RAGFlow",
      body: { task_type: "text_image", prompt: "Authorization: Bearer token-123 data:image/png;base64,abc", references: [] },
      leaked: "data:image/png;base64,abc"
    },
    {
      label: "verifiable long base64 image",
      body: { task_type: "text_image", prompt: rawBase64Value, references: [] },
      leaked: rawBase64Value
    },
    {
      label: "verifiable low-entropy long base64",
      body: { task_type: "text_image", prompt: lowEntropyBase64Value, references: [] },
      leaked: lowEntropyBase64Value
    },
    {
      label: "credential inside reference metadata",
      body: {
        task_type: "image_reference",
        prompt: "基于 @海报参考 生成一张新的品牌视觉图",
        references: [reference(
          "ref_poster",
          "海报参考",
          "style",
          "style_reference",
          "https://example.com/ref_poster.png",
          `Authorization: Bearer ${bearerValue}`
        )]
      },
      leaked: bearerValue
    }
  ];

  for (const { label, body, leaked } of cases) {
    let fetches = 0;
    const { result, output } = await captureConsoleDuring(() => handlePromptOptimization(body, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch with credential payload");
      }
    }));
    assert.equal(result.statusCode, 400, label);
    assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA", label);
    assert.equal(fetches, 0, label);
    assert.equal(JSON.stringify(result.payload).includes(leaked), false, label);
    assert.equal(output.includes(leaked), false, label);
    assertNoPublicLeaks(result.payload);
  }
});

test("prompt optimizer enforces prompt and reference character and byte boundaries", async () => {
  const promptAtLimit = "山".repeat(86);
  const promptEnv = {
    PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS: "86",
    PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES: String(Buffer.byteLength(promptAtLimit, "utf8"))
  };
  let result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: promptAtLimit,
    references: []
  }, { env: promptEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 200);

  result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: `${promptAtLimit}山`,
    references: []
  }, { env: promptEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  const emojiPromptAtLimit = `${"山".repeat(84)}😀`;
  const emojiEnv = {
    PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS: "85",
    PROMPT_OPTIMIZATION_MAX_PROMPT_BYTES: String(Buffer.byteLength(emojiPromptAtLimit, "utf8"))
  };
  result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: emojiPromptAtLimit,
    references: []
  }, { env: emojiEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 200);

  result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: `${emojiPromptAtLimit}a`,
    references: []
  }, {
    env: { ...emojiEnv, PROMPT_OPTIMIZATION_MAX_PROMPT_CHARS: "86" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  const refAtLimit = reference(
    "ref_packaging",
    "包装参考",
    "style",
    "style_reference",
    "https://example.com/ref_packaging.png",
    "山".repeat(40)
  );
  const refTextAtLimit = [refAtLimit.entity_name, refAtLimit.display_name, refAtLimit.description].join("\n");
  const referenceEnv = {
    PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_CHARS: String(Array.from(refTextAtLimit).length),
    PROMPT_OPTIMIZATION_MAX_REFERENCE_TEXT_BYTES: String(Buffer.byteLength(refTextAtLimit, "utf8"))
  };
  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @包装参考 生成一张安全培训海报",
    references: [refAtLimit]
  }, { env: referenceEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 200);

  const refOverLimit = { ...refAtLimit, description: `${refAtLimit.description}山` };
  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @包装参考 生成一张安全培训海报",
    references: [refOverLimit]
  }, { env: referenceEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  const aggregateRefs = [
    reference("ref_style", "风格参考", "style", "style_reference", "https://example.com/ref_style.png", "青".repeat(36)),
    reference("ref_light", "光线参考", "lighting", "lighting_reference", "https://example.com/ref_light.png", "蓝".repeat(36))
  ];
  const aggregateText = aggregateRefs.map((ref) => [ref.entity_name, ref.display_name, ref.description].join("\n")).join("\n");
  const aggregateEnv = {
    PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_CHARS: String(Array.from(aggregateText).length),
    PROMPT_OPTIMIZATION_MAX_REFERENCE_AGGREGATE_BYTES: String(Buffer.byteLength(aggregateText, "utf8"))
  };
  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @风格参考 和 @光线参考 生成一张安全培训海报",
    references: aggregateRefs
  }, { env: aggregateEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 200);

  const aggregateOverRefs = [aggregateRefs[0], { ...aggregateRefs[1], description: `${aggregateRefs[1].description}蓝` }];
  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @风格参考 和 @光线参考 生成一张安全培训海报",
    references: aggregateOverRefs
  }, { env: aggregateEnv, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
});

test("PromptOptimizationRequest JSON depth key array and string limits are exact", async () => {
  let result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "山".repeat(86),
    references: []
  }, {
    env: {
      PROMPT_OPTIMIZATION_MAX_JSON_KEYS: "3",
      PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH: "0",
      PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS: "86"
    },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 200);

  result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: `${"山".repeat(86)}山`,
    references: []
  }, {
    env: { PROMPT_OPTIMIZATION_MAX_JSON_STRING_CHARS: "86" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  result = await handlePromptOptimization({
    request_id: "req_key_over",
    task_type: "text_image",
    prompt: "山".repeat(86),
    references: []
  }, {
    env: { PROMPT_OPTIMIZATION_MAX_JSON_KEYS: "3" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  const oneRef = reference("ref_style", "风格参考", "style", "style_reference");
  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @风格参考 生成一张安全培训海报",
    references: [oneRef]
  }, {
    env: { PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH: "1", PROMPT_OPTIMIZATION_MAX_JSON_DEPTH: "3" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 200);

  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @风格参考 生成一张安全培训海报",
    references: [oneRef, reference("ref_light", "光线参考", "lighting", "lighting_reference")]
  }, {
    env: { PROMPT_OPTIMIZATION_MAX_JSON_ARRAY_LENGTH: "1" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");

  result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @风格参考 生成一张安全培训海报",
    references: [oneRef]
  }, {
    env: { PROMPT_OPTIMIZATION_MAX_JSON_DEPTH: "2" },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA");
});

test("RAGFlow request body and message limits are exact and block fetch on overrun", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  let capturedBodyBytes = 0;
  let capturedMessageChars = 0;

  await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async (_url, init) => {
      capturedBodyBytes = Buffer.byteLength(init.body, "utf8");
      const body = JSON.parse(init.body);
      capturedMessageChars = body.messages.reduce((total, message) => total + Array.from(message.content).length, 0);
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ visual_focus: "边界内增强" }) } }]
      });
    }
  });
  assert.equal(capturedBodyBytes > 512, true);
  assert.equal(capturedMessageChars > 128, true);

  let fetches = 0;
  await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_MAX_REQUEST_BYTES: String(capturedBodyBytes) }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ visual_focus: "恰好上限增强" }) } }]
      });
    }
  });
  assert.equal(fetches, 1);

  fetches = 0;
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_MAX_REQUEST_BYTES: String(capturedBodyBytes - 1) }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch oversized request body");
    }
  }), isInvalidRequestSchema);
  assert.equal(fetches, 0);

  fetches = 0;
  await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_MAX_REQUEST_MESSAGE_CHARS: String(capturedMessageChars) }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ visual_focus: "消息恰好上限增强" }) } }]
      });
    }
  });
  assert.equal(fetches, 1);

  fetches = 0;
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_MAX_REQUEST_MESSAGE_CHARS: String(capturedMessageChars - 1) }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch oversized request messages");
    }
  }), isInvalidRequestSchema);
  assert.equal(fetches, 0);

  const wrappedResult = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_MAX_REQUEST_MESSAGE_CHARS: "128" }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      throw new Error("must not fetch oversized wrapped request");
    }
  });
  assert.equal(wrappedResult.statusCode, 400);
  assert.equal(wrappedResult.payload.error_code, "INVALID_REQUEST_SCHEMA");
  assert.equal(wrappedResult.payload.message.includes("RAGFlow"), false);
  assertNoPublicLeaks(wrappedResult.payload);
});

test("task_type is separated from generation_mode", async () => {
  const characterTextToImage = await handlePromptOptimization({
    task_type: "character_multiview",
    prompt: "生成一名银发医师的角色四视图设定图",
    references: []
  }, offlineOptions());
  assert.equal(characterTextToImage.statusCode, 200);
  assert.equal(characterTextToImage.payload.generation_mode, "text_to_image");
  assertCharacterPrompt(characterTextToImage.payload.optimized_prompt, "角色");

  const sceneImageToImage = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @庭院 的现场光影多视角参考图",
    references: [reference("ref_scene", "庭院", "scene", "scene_reference")]
  }, offlineOptions());
  assert.equal(sceneImageToImage.statusCode, 200);
  assert.equal(sceneImageToImage.payload.generation_mode, "image_to_image");
  assertScenePrompt(sceneImageToImage.payload.optimized_prompt, ["庭院"]);
});

test("prompt optimizer rejects text_image references like the final API contract", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "生成 @山间晨雾。",
    references: [reference("ref_scene", "山间晨雾", "scene", "scene_reference")]
  }, offlineOptions());
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.error_code, "REFERENCES_NOT_ALLOWED");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("PromptOptimizationRequest references strict validation rejects malformed references", async () => {
  const validRef = reference("ref_scene", "山间晨雾", "scene", "scene_reference");
  const cases = [
    {
      label: "references must be array",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: { ...validRef } }
    },
    {
      label: "references max length",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: Array.from({ length: 17 }, (_, index) => reference(`ref_${index}`, `山间晨雾${index}`, "scene", "scene_reference")) }
    },
    {
      label: "reference object required",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: ["bad"] }
    },
    {
      label: "reference_id format",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, reference_id: "1bad" }] }
    },
    {
      label: "entity_name required",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, entity_name: "" }] }
    },
    {
      label: "entity_type enum",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, entity_type: "unknown_entity" }] }
    },
    {
      label: "role enum",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, role: "unknown_role" }] }
    },
    {
      label: "private URL",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, url: "http://127.0.0.1/ref.png" }] }
    },
    {
      label: "bad MIME",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, mime_type: "text/plain" }] }
    },
    {
      label: "bad order type",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, order: "1" }] }
    },
    {
      label: "bad order range",
      body: { task_type: "image_reference", prompt: "参考 @山间晨雾 生成新图。", references: [{ ...validRef, order: 1001 }] }
    }
  ];

  for (const { label, body } of cases) {
    const result = await handlePromptOptimization(body, offlineOptions());
    assert.equal(result.statusCode, 400, label);
    assert.equal(result.payload.status, "failed", label);
    assert.equal("optimized_prompt" in result.payload, false, label);
    assertNoPublicLeaks(result.payload);
  }
});

test("image_reference without references returns needs_clarification and does not include optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于参考图生成新图",
    references: []
  }, offlineOptions());
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal(result.payload.error_code, "REFERENCE_REQUIRED");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow enhancement can participate in deterministic compiler", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ visual_focus: "强调潮湿空气、树叶反光和远处暖窗光" }) } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.match(result.payload.optimized_prompt, /潮湿空气|树叶反光|暖窗光/);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow upstream hard failures return prompt optimizer error envelope", async () => {
  for (const [status, code] of [
    [404, "RAGFLOW_OPENAI_ENDPOINT_NOT_FOUND"],
    [500, "RAGFLOW_OPTIMIZER_FAILED"]
  ]) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => jsonResponse({ message: "upstream failed" }, { ok: false, status })
    });
    assert.equal(result.payload.status, "failed", String(status));
    assert.equal(result.payload.error_code, code, String(status));
    assert.match(result.payload.trace_id, /^trace_/, String(status));
    assert.equal("optimized_prompt" in result.payload, false, String(status));
    assertNoPublicLeaks(result.payload);
  }
});

test("RAGFlow enhancement fields must be consumed by the current task before changing template path", async () => {
  const character = await handlePromptOptimization({
    task_type: "character_multiview",
    prompt: "生成 @云岚 的角色一致性参考图",
    references: [reference("ref_char", "云岚", "character", "character_reference")]
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ story_function: "未被角色任务消费的剧情功能" }) } }]
    })
  });
  assert.equal(character.statusCode, 200);
  assert.equal(character.payload.status, "succeeded");
  assert.equal(character.payload.optimized_prompt.includes("未被角色任务消费"), false);
  assert.equal(character.payload.optimized_prompt.includes("4 格横向布局"), false);
  assert.equal(character.payload.optimized_prompt.includes("头部特写"), false);

  const storyboard = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ normalized_shot_plan: [{ original_order: 1, core_action: "未消费分镜字段" }] }) } }]
    })
  });
  assert.equal(storyboard.statusCode, 200);
  assert.equal(storyboard.payload.status, "succeeded");
  assert.equal(storyboard.payload.optimized_prompt.includes("未消费分镜字段"), false);
  assert.equal(storyboard.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(storyboard.payload.optimized_prompt.includes("右侧剧情宫格区"), false);

  const textImage = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ scene_summary: "未被文生图任务消费的场景摘要" }) } }]
    })
  });
  assert.equal(textImage.payload.status, "succeeded");
  assert.equal(textImage.payload.optimized_prompt.includes("未被文生图任务消费"), false);
  assertTextImagePrompt(textImage.payload.optimized_prompt);
  assertNoPublicLeaks(character.payload);
  assertNoPublicLeaks(storyboard.payload);
  assertNoPublicLeaks(textImage.payload);
});

test("RAGFlow invalid, field-summary, failure, or unauthorized enhancement is discarded", async () => {
  const badCandidates = [
    { choices: [{ message: { content: "任务类型：text_image\n原始需求：雨后森林" } }] },
    { choices: [{ message: { content: "{\"visual_focus\":\"安全光影\",\"visual_focus\":\"duplicate-wins\"}" } }] },
    { choices: [{ message: { content: "{\"visual_focus\":\"安全光影\",\"visual-focus\":\"canonical-wins\"}" } }] },
    { choices: [{ message: { content: JSON.stringify({ reference_id: "unknown_ref", visual_focus: "越权引用" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ asset_id: "asset_1", visual_focus: "越权资产" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: `Authorization: Bearer tok_${"A".repeat(32)}` }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "Cookie: sid=secret-value" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: `inline data:image/png;base64,${samplePngBase64()}` }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "local file:///etc/passwd" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "ftp://evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "javascript:alert(1)" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "blob:https://evil.example/id" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "//evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "visit evil.example/ref.png" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "RAG\u2060Flow 内部状态" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "provider\u2060_internal_payload 泄漏" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ visual_focus: "final\uFE0F_prompt 泄漏" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ internal_prompt: "secret", visual_focus: "内部提示词" }) } }] },
    { code: 100, data: null, message: "internal failure" }
  ];
  for (const candidate of badCandidates) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => jsonResponse(candidate)
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assert.equal(result.payload.optimized_prompt.includes("越权引用"), false);
    assert.equal(result.payload.optimized_prompt.includes("越权资产"), false);
    assert.equal(result.payload.optimized_prompt.includes("duplicate-wins"), false);
    assert.equal(result.payload.optimized_prompt.includes("canonical-wins"), false);
    assert.equal(result.payload.optimized_prompt.includes("Authorization"), false);
    assert.equal(result.payload.optimized_prompt.includes("Cookie"), false);
    assert.equal(result.payload.optimized_prompt.includes("data:image"), false);
    assert.equal(result.payload.optimized_prompt.includes("file://"), false);
    assert.equal(result.payload.optimized_prompt.includes("ftp://"), false);
    assert.equal(result.payload.optimized_prompt.includes("javascript:"), false);
    assert.equal(result.payload.optimized_prompt.includes("blob:"), false);
    assert.equal(result.payload.optimized_prompt.includes("evil.example"), false);
    assert.equal(result.payload.optimized_prompt.includes("内部提示词"), false);
    assertNoPublicLeaks(result.payload);
  }
});

test("validateRagflowEnhancement rejects internal and unauthorized content", () => {
  const context = {
    binding: { resolved_references: [reference("ref_scene", "庭院", "scene", "scene_reference", "https://example.com/ref_scene.png")] }
  };
  assert.equal(validateRagflowEnhancement({ final_prompt: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ internal_prompt: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "https://example.com/ref_scene.png" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "http://bad.example/x.png" }, context), null);
  assert.equal(validateRagflowEnhancement({ reference_id: "bad_ref", visual_focus: "x" }, context), null);
  assert.equal(validateRagflowEnhancement({ shot_plan: [{ asset_id: "asset_1", text: "x" }] }, context), null);
  assert.equal(validateRagflowEnhancement({ template_guidance: "旧字段" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "RAG\u2060Flow 内部状态" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "provider\u2060_internal_payload 泄漏" }, context), null);
  assert.equal(validateRagflowEnhancement({ visual_focus: "final\uFE0F_prompt 泄漏" }, context), null);
  const nestedUnsafeEnhancements = [
    "{\"action_stages\":[{\"constructor\":\"构造器泄漏\",\"prototype\":\"原型泄漏\",\"＿＿ｐｒｏｔｏ＿＿\":\"全角proto泄漏\",\"ｃｏｎｓｔｒｕｃｔｏｒ\":\"全角泄漏\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"references\":\"nested reference leak\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"reference_policy\":\"nested policy leak\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"output\":\"nested output leak\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"ｅｎｈａｎｃｅｍｅｎｔ\":\"nested enhancement leak\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"final️_prompt\":\"default ignorable leak\",\"stage\":\"安全阶段\"}]}",
    "{\"action_stages\":[{\"final󠄀_prompt\":\"supplementary default ignorable leak\",\"stage\":\"安全阶段\"}]}"
  ];
  for (const raw of nestedUnsafeEnhancements) {
    assert.equal(validateRagflowEnhancement(JSON.parse(raw), {
      request: { task_type: "storyboard" },
      binding: { resolved_references: [] }
    }), null);
  }
  assert.equal(validateRagflowEnhancement(JSON.parse("{\"action_stages\":[{\"stage\":\"安全阶段\",\"st-age\":\"规范化冲突\"}]}"), {
    request: { task_type: "storyboard" },
    binding: { resolved_references: [] }
  }), null);
  const safeStageEnhancement = validateRagflowEnhancement(JSON.parse("{\"action_stages\":[{\"stage\":\"安全阶段\"}]}"), {
    request: { task_type: "storyboard" },
    binding: { resolved_references: [] }
  });
  assert.equal(safeStageEnhancement?.action_stages?.[0]?.stage, "安全阶段");
  assert.deepEqual(validateRagflowEnhancement({ missing_constraints: "补充用户未写明的可见约束" }, context), { missing_constraints: "补充用户未写明的可见约束" });
  assert.deepEqual(validateRagflowEnhancement({ visual_focus: "保留庭院空间层次" }, context), { visual_focus: "保留庭院空间层次" });
});

test("RAGFlow response parser discards natural language instead of treating it as a prompt", () => {
  const parsed = parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "加强冷色调现场光影和空间纵深。" } }]
  });
  assert.equal(parsed, null);
});

test("RAGFlow response parser rejects duplicate and canonical-conflicting JSON candidates", () => {
  assert.equal(parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "{\"visual_focus\":\"安全光影\",\"visual_focus\":\"duplicate-wins\"}" } }]
  }), null);
  assert.equal(parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "{\"visual_focus\":\"安全光影\",\"visual-focus\":\"canonical-wins\"}" } }]
  }), null);
  assert.equal(parseRagflowOptimizedPrompt({
    choices: [{ message: { content: "{\"visual_focus\":\"安全光影\",\"visual️_focus\":\"default-ignorable-wins\"}" } }]
  }), null);
});

test("RAGFlow config can be read from ai-tu runtime config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    ragflowBaseUrl: "http://ragflow.local",
    ragflowApiKey: "test-key",
    ragflowChatId: "chat_001"
  }), "utf8");
  try {
    const config = ragflowConfig({ AI_TU_RUNTIME_CONFIG_FILE: configFile, RAGFLOW_DEPLOYMENT_TIER: "test" });
    assert.equal(config.endpoint, "http://ragflow.local/api/v1/openai/chat_001/chat/completions");
    assert.equal(config.tier, "test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RAGFlow config can be read from markdown runtime config notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-md-"));
  const configFile = join(dir, "runtime-config.md");
  writeFileSync(configFile, `${JSON.stringify({
    ragflowBaseUrl: "http://ragflow.local",
    ragflowApiKey: "test-key",
    ragflowChatId: "chat_001"
  }, null, 2)}

Local notes below the JSON object are ignored.
`, "utf8");
  try {
    const config = ragflowConfig({ AI_TU_RUNTIME_CONFIG_FILE: configFile, RAGFLOW_DEPLOYMENT_TIER: "test" });
    assert.equal(config.endpoint, "http://ragflow.local/api/v1/openai/chat_001/chat/completions");
    assert.equal(config.tier, "test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit AI_TU_RUNTIME_CONFIG_FILE isolates RAGFlow config fallback", async () => {
  let fetches = 0;
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: { AI_TU_RUNTIME_CONFIG_FILE: "/tmp/definitely-missing-ragflow-config.json" },
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch when explicit runtime config is missing");
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.equal(fetches, 0);
  assertNoPublicLeaks(result.payload);
});

test("explicit invalid RAGFlow hardening config fails closed even when endpoint config is absent", async () => {
  for (const [key, value] of [
    ["RAGFLOW_TIMEOUT_MS", "0"],
    ["RAGFLOW_DEPLOYMENT_TIER", "prod"],
    ["RAGFLOW_ALLOWED_ORIGINS", "https://ragflow.example.com/path"]
  ]) {
    let fetches = 0;
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: {
        AI_TU_RUNTIME_CONFIG_FILE: "/tmp/definitely-missing-ragflow-hardening-config.json",
        [key]: value
      },
      lookupHost: publicLookup,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("must not fetch with invalid explicit RAGFlow hardening config");
      }
    });
    assert.equal(result.statusCode, 503, `${key}=${value}`);
    assert.equal(result.payload.status, "failed", `${key}=${value}`);
    assert.equal(result.payload.error_code, "RAGFLOW_CONFIG_INVALID", `${key}=${value}`);
    assert.match(result.payload.trace_id, /^trace_/, `${key}=${value}`);
    assert.equal("optimized_prompt" in result.payload, false, `${key}=${value}`);
    assert.equal(fetches, 0, `${key}=${value}`);
    assertNoPublicLeaks(result.payload);
  }
});

test("RAGFlow environment variables override runtime config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-config-override-"));
  const configFile = join(dir, "runtime-config.json");
  writeFileSync(configFile, JSON.stringify({
    ragflowBaseUrl: "http://file-ragflow.local",
    ragflowApiKey: "file-key",
    ragflowChatId: "file_chat"
  }), "utf8");
  try {
    const config = ragflowConfig({
    AI_TU_RUNTIME_CONFIG_FILE: configFile,
    RAGFLOW_BASE_URL: "http://env-ragflow.local",
    RAGFLOW_API_KEY: "env-key",
    RAGFLOW_CHAT_ID: "env_chat",
    RAGFLOW_MODEL: "custom-chat-model",
    RAGFLOW_DEPLOYMENT_TIER: "test"
  });
    assert.equal(config.endpoint, "http://env-ragflow.local/api/v1/openai/env_chat/chat/completions");
    assert.equal(config.model, "custom-chat-model");
    assert.equal(config.tier, "test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RAGFlow URL policy rejects unsafe schemes userinfo private hosts malformed allowlists and invalid tiers", () => {
  const base = {
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001",
    RAGFLOW_DEPLOYMENT_TIER: "test"
  };
  for (const RAGFLOW_BASE_URL of [
    "file:///tmp/ragflow",
    "data:text/plain,ragflow",
    "javascript:alert(1)",
    "blob:https://example.com/id",
    "https://user:pass@ragflow.example.com",
    "http://127.0.0.1:9380",
    "http://localhost:9380",
    "http://10.0.0.1:9380",
    "http://172.16.0.1:9380",
    "http://192.168.1.2:9380",
    "http://169.254.169.254",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://[::1]:9380",
    "http://[fe80::1]:9380",
    "http://[fc00::1]:9380",
    "http://[ff02::1]:9380",
    "http://[::ffff:127.0.0.1]:9380",
    "http://[::ffff:0.0.0.0]:9380",
    "https://ragflow.example.com/tenant-a",
    "https://ragflow.example.com?endpoint=https://evil.example",
    "https://ragflow.example.com#frag"
  ]) {
    assert.throws(() => ragflowConfig({ ...base, RAGFLOW_BASE_URL }), isRagflowConfigInvalid);
  }
  for (const RAGFLOW_BASE_URL of [
    "http://169.254.169.254",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://[fe80::1]",
    "http://[ff02::1]"
  ]) {
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL,
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }), isRagflowConfigInvalid);
  }

  for (const RAGFLOW_DEPLOYMENT_TIER of ["prod", "stage", "qa", "unknown"]) {
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER
    }), isRagflowConfigInvalid);
  }

  const missingTierBase = { ...base };
  delete missingTierBase.RAGFLOW_DEPLOYMENT_TIER;
  assert.throws(() => ragflowConfig({
    ...missingTierBase,
    RAGFLOW_BASE_URL: "https://ragflow.example.com"
  }), isRagflowConfigInvalid);

  for (const RAGFLOW_ALLOWED_ORIGINS of [
    "not-a-url",
    "https://user:pass@ragflow.example.com",
    "https://ragflow.example.com/path",
    "https://ragflow.example.com?x=1"
  ]) {
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_ALLOWED_ORIGINS
    }), isRagflowConfigInvalid);
  }

  assert.throws(() => ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "https://ragflow.example.com:8443",
    RAGFLOW_ALLOWED_ORIGINS: "https://ragflow.example.com"
  }), isRagflowConfigInvalid);

  assert.equal(ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "https://ragflow.example.com",
    RAGFLOW_ALLOWED_ORIGINS: "https://ragflow.example.com:443"
  }).endpoint, "https://ragflow.example.com/api/v1/openai/chat_001/chat/completions");

  assert.equal(ragflowConfig({
    ...base,
    RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
    RAGFLOW_DEPLOYMENT_TIER: "test",
    RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
  }).endpoint, "http://127.0.0.1:9380/api/v1/openai/chat_001/chat/completions");
});

test("RAGFlow numeric resource configuration fails closed on invalid explicit values", () => {
  const base = ragflowEnv();
  for (const [key, value] of [
    ["RAGFLOW_TIMEOUT_MS", "0"],
    ["RAGFLOW_TIMEOUT_MS", "Infinity"],
    ["RAGFLOW_DNS_TIMEOUT_MS", "0"],
    ["RAGFLOW_DNS_TIMEOUT_MS", "999999"],
    ["RAGFLOW_MAX_REQUEST_BYTES", "0"],
    ["RAGFLOW_MAX_REQUEST_MESSAGE_CHARS", "NaN"],
    ["RAGFLOW_MAX_RESPONSE_BYTES", "1"],
    ["RAGFLOW_MAX_JSON_DEPTH", "1"],
    ["RAGFLOW_MAX_JSON_KEYS", "0"],
    ["RAGFLOW_MAX_JSON_ARRAY_LENGTH", "0"],
    ["RAGFLOW_MAX_JSON_STRING_LENGTH", "1"],
    ["RAGFLOW_MAX_ENHANCEMENT_CHARS", "0"]
  ]) {
    assert.throws(() => ragflowConfig({ ...base, [key]: value }), isRagflowConfigInvalid, `${key}=${value}`);
  }
});

test("RAGFlow explicit hardening config is validated even when runtime config is absent", async () => {
  const missingFileEnv = { AI_TU_RUNTIME_CONFIG_FILE: "/tmp/prompt-optimizer-missing-runtime-config.json" };
  for (const env of [
    { ...missingFileEnv, RAGFLOW_TIMEOUT_MS: "0" },
    { ...missingFileEnv, RAGFLOW_DEPLOYMENT_TIER: "prod" },
    { ...missingFileEnv, RAGFLOW_ALLOWED_ORIGINS: "not-a-url" }
  ]) {
    assert.throws(() => ragflowConfig(env), isRagflowConfigInvalid);
  }

  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: { ...missingFileEnv, RAGFLOW_TIMEOUT_MS: "0" },
    fetchImpl: async () => {
      throw new Error("must not fetch with invalid RAGFlow config");
    }
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.error_code, "RAGFLOW_CONFIG_INVALID");
  assert.match(result.payload.trace_id, /^trace_/);
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("prompt optimizer public handler fails closed on invalid RAGFlow numeric config", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "0" }),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      throw new Error("must not fetch with invalid RAGFlow config");
    }
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.status, "failed");
  assert.equal(result.payload.error_code, "RAGFLOW_CONFIG_INVALID");
  assert.match(result.payload.trace_id, /^trace_/);
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow production and staging require HTTPS explicit origin and always reject private endpoints", () => {
  const base = {
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001"
  };
  for (const tier of ["production", "staging"]) {
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: tier
    }), isRagflowConfigInvalid);
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "http://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOWED_ORIGINS: "http://ragflow.example.com"
    }), isRagflowConfigInvalid);
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOWED_ORIGINS: "https://other.example.com"
    }), isRagflowConfigInvalid);
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://127.0.0.1:9380",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOWED_ORIGINS: "https://127.0.0.1:9380",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }), isRagflowConfigInvalid);
    assert.equal(ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOWED_ORIGINS: "https://ragflow.example.com"
    }).endpoint, "https://ragflow.example.com/api/v1/openai/chat_001/chat/completions");
  }
});

test("RAGFlow development and test reject private endpoints unless explicit override is enabled", () => {
  const base = {
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001"
  };
  for (const tier of ["development", "test"]) {
    assert.equal(ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "http://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: tier
    }).endpoint, "http://ragflow.example.com/api/v1/openai/chat_001/chat/completions");
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
      RAGFLOW_DEPLOYMENT_TIER: tier
    }), isRagflowConfigInvalid);
    assert.equal(ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }).endpoint, "http://127.0.0.1:9380/api/v1/openai/chat_001/chat/completions");
    assert.throws(() => ragflowConfig({
      ...base,
      RAGFLOW_BASE_URL: "http://169.254.169.254",
      RAGFLOW_DEPLOYMENT_TIER: tier,
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }), isRagflowConfigInvalid);
  }
});

test("RAGFlow private endpoint opt-in allows local dev endpoints without widening metadata ranges", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  let calls = 0;
  const candidate = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({
      RAGFLOW_BASE_URL: "http://127.0.0.1:9380",
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }),
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, "http://127.0.0.1:9380/api/v1/openai/chat_001/chat/completions");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ visual_focus: "本地知识库补充画面雾气层次" }) } }]
      });
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(candidate, { visual_focus: "本地知识库补充画面雾气层次" });

  const blockedCalls = [];
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({
      RAGFLOW_BASE_URL: "https://ragflow.example.com",
      RAGFLOW_DEPLOYMENT_TIER: "test",
      RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
    }),
    lookupHost: async () => [{ address: "169.254.169.254", family: 4 }],
    fetchImpl: async (url, init) => {
      blockedCalls.push({ url, authorization: init?.headers?.Authorization || "" });
      return jsonResponse({});
    }
  }), isRagflowConfigInvalid);
  assert.deepEqual(blockedCalls, []);
});

test("RAGFlow prompt optimizer helper blocks sensitive outbound payloads before fetch", async () => {
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  const cases = [
    { label: "bearer credential", prompt: `Authorization: Bearer tok_${"A".repeat(32)}` },
    { label: "generic data URI", prompt: "data:text/plain;base64,abc" },
    { label: "low entropy long base64", prompt: lowEntropyLongBase64() }
  ];

  for (const item of cases) {
    let fetches = 0;
    await assert.rejects(() => callRagflowPromptOptimizer({
      request: {
        ...promptRequest(),
        prompt: item.prompt
      },
      binding,
      referencePlan,
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => {
        fetches += 1;
        throw new Error(`must not fetch ${item.label}`);
      }
    }), isInvalidRequestSchema, item.label);
    assert.equal(fetches, 0, item.label);
  }
});

test("RAGFlow default fetch path pins validated DNS result and aborts oversized streams", async () => {
  await withRagflowServer((request, response) => {
    assert.equal(request.headers.host.startsWith("ragflow.localtest:"), true);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ visual_focus: "pinned lookup enhancement" }) } }]
    }));
  }, async ({ baseUrl }) => {
    const candidate = await callRagflowPromptOptimizer({
      request: promptRequest(),
      binding: { resolved_references: [], references_used: [], entity_mentions: [] },
      referencePlan: buildReferencePlan({ resolved_references: [] }),
      env: ragflowEnv({
        RAGFLOW_BASE_URL: baseUrl,
        RAGFLOW_DEPLOYMENT_TIER: "test",
        RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true"
      }),
      lookupHost: localLookup
    });
    assert.deepEqual(candidate, { visual_focus: "pinned lookup enhancement" });
  });

  await withRagflowServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    for (let index = 0; index < 128; index += 1) {
      response.write("x".repeat(1024));
    }
    response.end();
  }, async ({ baseUrl }) => {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv({
        RAGFLOW_BASE_URL: baseUrl,
        RAGFLOW_DEPLOYMENT_TIER: "test",
        RAGFLOW_ALLOW_PRIVATE_ENDPOINTS: "true",
        RAGFLOW_MAX_RESPONSE_BYTES: "2048"
      }),
      lookupHost: localLookup
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  });
});

test("RAGFlow DNS rebinding and redirects do not leak Authorization to unapproved origins", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });
  const calls = [];
  await assert.rejects(() => callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_BASE_URL: "https://ragflow.example.com" }),
    lookupHost: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init?.headers?.Authorization || "" });
      return jsonResponse({});
    }
  }), isRagflowConfigInvalid);
  assert.deepEqual(calls, []);

  const redirectCalls = [];
  const redirected = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_BASE_URL: "https://ragflow.example.com" }),
    lookupHost: publicLookup,
    fetchImpl: async (url, init) => {
      redirectCalls.push({
        url,
        redirect: init.redirect,
        headers: init.headers,
        authorization: init.headers.Authorization
      });
      return {
        ok: false,
        status: 302,
        headers: {
          get: (name) => name.toLowerCase() === "location" ? "https://evil.example/steal" : null
        },
        text: async () => ""
      };
    }
  });
  assert.equal(redirected, null);
  assert.equal(redirectCalls.length, 1);
  assert.equal(redirectCalls[0].url, "https://ragflow.example.com/api/v1/openai/chat_001/chat/completions");
  assert.equal(redirectCalls[0].redirect, "manual");
  assert.equal(redirectCalls[0].authorization, "Bearer test-key");
  assert.deepEqual(Object.keys(redirectCalls[0].headers).sort(), ["Accept", "Authorization", "Content-Type"]);
  assert.equal(redirectCalls[0].headers.Accept, "application/json");
});

test("RAGFlow response resource limits discard enhancement and keep deterministic fallback", async () => {
  const cases = [
    () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/plain" : null },
      text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] })
    }),
    () => jsonResponse({ choices: [{ message: { content: "{}" } }] }, { headers: { "content-length": String(70 * 1024) } }),
    () => jsonResponse({ nested: { a: { b: { c: { d: { e: { f: { g: { h: "too deep" } } } } } } } } }),
    () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ visual_focus: "x".repeat(5000) }) } }] }),
    () => jsonResponse({ choices: [{ message: { content: "{not-json" } }] }),
    () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }
  ];

  for (const makeResponse of cases) {
    const result = await handlePromptOptimization({
      task_type: "text_image",
      prompt: "雨后森林里的小木屋",
      references: []
    }, {
      env: ragflowEnv(),
      lookupHost: publicLookup,
      fetchImpl: async () => makeResponse()
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.status, "succeeded");
    assertTextImagePrompt(result.payload.optimized_prompt);
    assert.equal(result.payload.optimized_prompt.includes("too deep"), false);
    assertNoPublicLeaks(result.payload);
  }
});

test("RAGFlow timeout uses AbortController signal and falls back deterministically", async () => {
  let aborted = false;
  const startedAt = Date.now();
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "1000" }),
    lookupHost: publicLookup,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error("timeout wiring did not abort fetch")), 2500);
      init.signal.addEventListener("abort", () => {
        clearTimeout(guard);
        aborted = true;
        const error = new Error("aborted by timeout");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  assert.equal(aborted, true);
  assert.equal(Date.now() - startedAt >= 900, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assertTextImagePrompt(result.payload.optimized_prompt);
  assertNoPublicLeaks(result.payload);
});

test("RAGFlow DNS lookup timeout and elapsed lookup time constrain fetch budget", async () => {
  const request = promptRequest();
  const binding = { resolved_references: [], references_used: [], entity_mentions: [] };
  const referencePlan = buildReferencePlan({ resolved_references: [] });

  let lateResolved = false;
  let fetches = 0;
  const lateCandidate = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "80", RAGFLOW_DNS_TIMEOUT_MS: "20" }),
    lookupHost: async () => new Promise((resolveLookup) => {
      setTimeout(() => {
        lateResolved = true;
        resolveLookup([{ address: "93.184.216.34", family: 4 }]);
      }, 60);
    }),
    fetchImpl: async (_url, init) => {
      fetches += 1;
      assert.equal(init?.headers?.Authorization, undefined);
      throw new Error("must not fetch after DNS timeout");
    }
  });
  assert.equal(lateCandidate, null);
  assert.equal(fetches, 0);
  await delay(80);
  assert.equal(lateResolved, true);
  assert.equal(fetches, 0);

  const neverResult = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "80", RAGFLOW_DNS_TIMEOUT_MS: "20" }),
    lookupHost: async () => new Promise(() => {}),
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("must not fetch after never-resolving DNS");
    }
  });
  assert.equal(neverResult.statusCode, 200);
  assert.equal(neverResult.payload.status, "succeeded");
  assert.equal(fetches, 0);
  assertTextImagePrompt(neverResult.payload.optimized_prompt);
  assertNoPublicLeaks(neverResult.payload);

  let aborted = false;
  let fetchAbortDelay = 0;
  fetches = 0;
  const budgetCandidate = await callRagflowPromptOptimizer({
    request,
    binding,
    referencePlan,
    env: ragflowEnv({ RAGFLOW_TIMEOUT_MS: "140", RAGFLOW_DNS_TIMEOUT_MS: "100" }),
    lookupHost: async () => {
      await delay(60);
      return [{ address: "93.184.216.34", family: 4 }];
    },
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      fetches += 1;
      const startedAt = Date.now();
      init.signal.addEventListener("abort", () => {
        aborted = true;
        fetchAbortDelay = Date.now() - startedAt;
        const error = new Error("aborted by remaining deadline");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  assert.equal(budgetCandidate, null);
  assert.equal(fetches, 1);
  assert.equal(aborted, true);
  assert.equal(fetchAbortDelay < 120, true);
  assert.equal(fetchAbortDelay >= 40, true);
});

test("RAGFlow embedded JSON content limits and empty sanitization cannot trigger full templates", async () => {
  const deepContent = { shot_plan: [{ level1: { level2: { level3: { level4: { level5: { level6: { level7: "deep" } } } } } } }] };
  const deep = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv({ RAGFLOW_MAX_JSON_DEPTH: "4" }),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify(deepContent) } }]
    })
  });
  assert.equal(deep.statusCode, 200);
  assert.equal(deep.payload.status, "succeeded");
  assertStoryboardPrompt(deep.payload.optimized_prompt);
  assert.equal(deep.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(deep.payload.optimized_prompt.includes("右侧剧情宫格区"), false);
  assert.equal(deep.payload.optimized_prompt.includes("deep"), false);

  const emptyAfterSanitize = await handlePromptOptimization({
    task_type: "storyboard",
    prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
    references: []
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: JSON.stringify({ shot_plan: [{ asset_id: "asset_1" }] }) } }]
    })
  });
  assert.equal(emptyAfterSanitize.payload.status, "succeeded");
  assert.equal(emptyAfterSanitize.payload.optimized_prompt.includes("左侧规划区"), false);
  assert.equal(emptyAfterSanitize.payload.optimized_prompt.includes("右侧剧情宫格区"), false);
});

test("field-summary output is never returned as optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @营帐 在夜色中的现场光影多视角参考图",
    references: [reference("ref_scene", "营帐", "scene", "scene_reference")]
  }, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: "任务类型：场景多视图图。\n原始需求：生成 @营帐" } }]
    })
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assertScenePrompt(result.payload.optimized_prompt, ["营帐"]);
  assertNoPromptLeaks(result.payload.optimized_prompt);
});

test("prompt optimizer is isolated from provider store callback and image URL response fields", async () => {
  const result = await handlePromptOptimization({
    task_type: "text_image",
    prompt: "一幅中文水墨风格的春日山谷画面",
    references: []
  }, {
    env: {
      RAGFLOW_BASE_URL: "",
      RAGFLOW_API_KEY: "",
      RAGFLOW_CHAT_ID: "",
      IMAGE_API_KEY: "",
      IMAGE_API_BASE: "",
      IMAGE_EDIT_BASE: "",
      CALLBACK_URL: "https://client.example.com/cb"
    },
    fetchImpl: async () => {
      throw new Error("prompt optimizer should not call image provider, callback, or store fetches");
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "succeeded");
  assert.equal("images" in result.payload, false);
  assert.equal("callback_status" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("prompt optimizer public response gate rejects nested forbidden keys and text", () => {
  const request = promptRequest();
  const context = {
    referencePlan: buildReferencePlan({}),
    binding: {
      entity_mentions: [],
      references_used: [],
      warnings: []
    }
  };
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context,
    optimizedPrompt: "生成完整高质量中文画面，但这里包含 RAGFlow 内部状态。",
    traceId: "trace_test"
  }), /公共响应包含内部信息/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context,
    optimizedPrompt: "生成完整高质量中文画面，但这里包含 RAG\u2060Flow 内部状态。",
    traceId: "trace_test"
  }), /公共响应包含内部信息/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context,
    optimizedPrompt: "生成完整高质量中文画面，但这里包含 provider\u2060_internal_payload。",
    traceId: "trace_test"
  }), /公共响应包含内部信息/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context,
    optimizedPrompt: "生成完整高质量中文画面，但这里包含 final\uFE0F_prompt。",
    traceId: "trace_test"
  }), /公共响应包含内部信息/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context: {
      ...context,
      binding: {
        entity_mentions: [],
        references_used: [{ reference_id: "ref_safe", entity_name: "对象", provider_payload: "secret" }],
        warnings: []
      }
    },
    optimizedPrompt: "生成完整高质量中文画面，主体清楚，环境完整，光影稳定，细节清晰，适合直接用于图片生成。",
    traceId: "trace_test"
  }), /公共响应包含内部字段/);
  assert.throws(() => buildPromptOptimizationResponse({
    request,
    context: {
      ...context,
      binding: {
        entity_mentions: [],
        references_used: [{ reference_id: "ref_safe", entity_name: "对象", final️_prompt: "secret" }],
        warnings: []
      }
    },
    optimizedPrompt: "生成完整高质量中文画面，主体清楚，环境完整，光影稳定，细节清晰，适合直接用于图片生成。",
    traceId: "trace_test"
  }), /公共响应包含内部字段/);
});

test("local fallback does not inject full professional templates without user or knowledge source", async () => {
  const cases = [
    {
      task_type: "character_multiview",
      prompt: "生成 @云岚 的角色一致性参考图",
      references: [reference("ref_char", "云岚", "character", "character_reference")],
      forbidden: /4 格横向布局|正面全身|头部特写|侧面全身|背面全身|A 字站姿/
    },
    {
      task_type: "scene_multiview",
      prompt: "生成 @茶馆 的场景一致性参考图",
      references: [reference("ref_scene", "茶馆", "scene", "scene_reference")],
      forbidden: /3×3|等价多视图|全景镜头|中景镜头|俯视全景|平面布局图|分镜示意图/
    },
    {
      task_type: "prop_multiview",
      prompt: "生成 @铜铃 的道具一致性参考图",
      references: [reference("ref_prop", "铜铃", "prop", "prop_reference")],
      forbidden: /正面视图|侧面视图|背面视图|顶部 \/ 底部视图|结构拆解|材质特写|纹样 \/ 工艺特写/
    },
    {
      task_type: "storyboard",
      prompt: "少女推开门，看见远处灯塔亮起，随后奔向海岸。",
      references: [],
      forbidden: /左侧规划区|右侧剧情宫格区|剧情宫格区必须|宫格数量等于实际 shot 数量/
    }
  ];
  for (const item of cases) {
    const { forbidden, ...request } = item;
    const result = await handlePromptOptimization(request, offlineOptions());
    assert.equal(result.statusCode, 200, item.task_type);
    assert.equal(result.payload.status, "succeeded", item.task_type);
    assert.doesNotMatch(result.payload.optimized_prompt, forbidden, item.task_type);
    assertNoPromptLeaks(result.payload.optimized_prompt);
    assertNoPublicLeaks(result.payload);
  }
});

test("scene_multiview dynamic fixtures do not bleed entities", async () => {
  const caseA = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图",
    references: [
      reference("ref_char", "萧昭宁", "character", "character_reference"),
      reference("ref_scene", "营帐", "scene", "scene_reference")
    ]
  }, offlineOptions());
  assertScenePrompt(caseA.payload.optimized_prompt, ["营帐", "萧昭宁"]);

  const caseB = await handlePromptOptimization({
    task_type: "scene_multiview",
    prompt: "生成 @研究员 在 @现代实验室 中的冷色调现场光影多视角参考图",
    references: [
      reference("ref_researcher", "研究员", "character", "character_reference"),
      reference("ref_lab", "现代实验室", "scene", "scene_reference")
    ]
  }, offlineOptions());
  assertScenePrompt(caseB.payload.optimized_prompt, ["现代实验室", "研究员"]);
  assert.equal(caseB.payload.optimized_prompt.includes("营帐"), false);
  assert.equal(caseB.payload.optimized_prompt.includes("萧昭宁"), false);
});

test("prop_multiview dynamic fixture does not bleed unrelated sample props", async () => {
  const result = await handlePromptOptimization({
    task_type: "prop_multiview",
    prompt: "生成 @折叠罗盘 的道具结构多视图资产图",
    references: [reference("ref_prop", "折叠罗盘", "prop", "prop_reference")]
  }, offlineOptions());
  assertPropPrompt(result.payload.optimized_prompt, "折叠罗盘");
  for (const leaked of ["青铜香炉", "机械钥匙", "营帐", "现代实验室"]) {
    assert.equal(result.payload.optimized_prompt.includes(leaked), false);
  }
});

test("prompt optimizer failure does not return optimized_prompt", async () => {
  const result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "生成 @萧昭宁 和 @营帐",
    references: [reference("ref_char", "萧昭宁", "character", "character_reference")],
    reference_policy: { unbound_entity: "block" }
  }, offlineOptions());
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

test("prompt optimizer error envelope cannot escape on internal-looking user text", async () => {
  const result = await handlePromptOptimization({
    task_type: "image_reference",
    prompt: "基于 @RAGFlow 生成一张视觉图。",
    references: [],
    reference_policy: { unbound_entity: "block" }
  }, offlineOptions());
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, "needs_clarification");
  assert.equal(result.payload.error_code, "ENTITY_REFERENCE_NOT_FOUND");
  assert.match(result.payload.trace_id, /^trace_/);
  assert.equal(result.payload.message.includes("RAGFlow"), false);
  assert.equal("optimized_prompt" in result.payload, false);
  assertNoPublicLeaks(result.payload);
});

function reference(reference_id, entity_name, entity_type, role, url = `https://example.com/${reference_id}.png`, description = `${entity_name}参考图`, extra = {}) {
  return {
    reference_id,
    entity_name,
    entity_type,
    role,
    url,
    mime_type: "image/png",
    display_name: `${entity_name}.png`,
    description,
    ...extra
  };
}

async function assertPromptOptimizerRejectsBeforeRagflow({ label, body, leaked }) {
  let fetches = 0;
  const { result, output } = await captureConsoleDuring(() => handlePromptOptimization(body, {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => {
      fetches += 1;
      throw new Error(`must not fetch ${label}`);
    }
  }));
  assert.equal(result.statusCode, 400, label);
  assert.equal(result.payload.error_code, "INVALID_REQUEST_SCHEMA", label);
  assert.equal(fetches, 0, label);
  assert.equal(JSON.stringify(result.payload).includes(leaked), false, label);
  assert.equal(output.includes(leaked), false, label);
  assertNoPublicLeaks(result.payload);
}

function assertTextImagePrompt(prompt) {
  assert.match(prompt, /普通文字生图|完整高质量|主体明确|构图稳定/);
  assert.doesNotMatch(prompt, /4 格横向布局|场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertImageReferencePrompt(prompt, names) {
  assert.match(prompt, /基于参考图|保持参考对象|关键视觉特征|普通参考图生图/);
  for (const name of names) assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /4 格横向布局|场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertCharacterPrompt(prompt, name) {
  assert.match(prompt, /人物多视角|四视图|角色设定图|人物一致性参考图|角色一致性参考图|角色参考图/);
  assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /场景设定参考板结构|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertScenePrompt(prompt, names) {
  assert.match(prompt, /场景多视图|多机位|现场光影|场景设定参考板|场景一致性参考图|场景参考提示词/);
  for (const name of names) assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /4 格横向布局|道具多视图资产参考板|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertPropPrompt(prompt, name) {
  assert.match(prompt, /道具多视图|道具资产|多角度资产图|资产参考板|道具一致性参考图|道具资产提示词/);
  assertIncludesEntity(prompt, name);
  assert.doesNotMatch(prompt, /角色四视图|场景设定参考板结构|左侧规划区和右侧剧情宫格区/);
  assertNoPromptLeaks(prompt);
}

function assertStoryboardPrompt(prompt) {
  for (const word of ["故事板", "分镜"]) {
    assert.match(prompt, new RegExp(word));
  }
  assert.match(prompt, /不固定九宫格|不要固定九宫格/);
  assert.doesNotMatch(prompt, /采用 3×3 或等价多视图/);
  assertNoPromptLeaks(prompt);
}

function assertIncludesEntity(prompt, entityName) {
  assert.ok(prompt.includes(entityName) || prompt.includes(`@${entityName}`), `missing entity ${entityName}`);
}

function assertNoPromptLeaks(prompt) {
  const scanText = normalizeTextForSensitiveScan(prompt);
  for (const title of [
    "任务类型：",
    "原始需求：",
    "参考绑定：",
    "优化方向：",
    "画面要求：",
    "负向约束：",
    "task_type:",
    "references:",
    "reference binding:",
    "optimization direction:",
    "negative constraints:"
  ]) {
    assert.equal(scanText.includes(title), false, `field-summary title leaked: ${title}`);
  }
  for (const token of ["enhancement", "RAGFlow", "fallback", "provider_internal_payload", "raw_provider", "input_analysis", "storyboard_processing", "data:image"]) {
    assert.equal(scanText.includes(token), false, `internal token leaked: ${token}`);
  }
  assertNoSensitivePayload(prompt);
}

function assertNoPublicLeaks(payload) {
  const text = JSON.stringify(payload);
  const scanText = normalizeTextForSensitiveScan(text);
  for (const token of ["enhancement", "RAGFlow", "fallback", "provider_internal_payload", "raw_provider", "apiKey", "data:image"]) {
    assert.equal(scanText.includes(token), false, `forbidden token leaked: ${token}`);
  }
  assertNoSensitivePayload(text);
}

function assertNoSensitivePayload(text) {
  assert.equal(containsHighConfidenceSensitivePayload(text), false, "high-confidence sensitive payload leaked");
}

function ragflowEnvWith(overrides = {}) {
  return {
    RAGFLOW_BASE_URL: "http://ragflow.local",
    RAGFLOW_API_KEY: "test-key",
    RAGFLOW_CHAT_ID: "chat_001",
    RAGFLOW_DEPLOYMENT_TIER: "test",
    ...overrides
  };
}

function ragflowEnv(overrides = {}) {
  return ragflowEnvWith(overrides);
}

function offlineOptions() {
  return {
    env: ragflowEnv(),
    lookupHost: publicLookup,
    fetchImpl: async () => jsonResponse({ code: 100, data: null, message: "offline" })
  };
}

function noRagflowOptions() {
  return {
    env: {},
    fetchImpl: async () => {
      throw new Error("RAGFlow fetch should not run without config");
    }
  };
}

async function captureConsoleDuring(fn) {
  const lines = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  for (const name of Object.keys(original)) {
    console[name] = (...args) => {
      lines.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
    };
  }
  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}

function samplePngBase64() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82
  ]).toString("base64");
}

function lowEntropyLongBase64() {
  return Buffer.alloc(96, 0).toString("base64");
}

function jsonResponse(json, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    text: async () => JSON.stringify(json),
    headers: {
      get: (name) => {
        const headers = {
          "content-type": "application/json",
          ...(options.headers || {})
        };
        return headers[String(name || "").toLowerCase()] || null;
      }
    }
  };
}

function publicLookup() {
  return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function localLookup() {
  return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
}

async function withRagflowServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    await fn({ baseUrl: `http://ragflow.localtest:${port}` });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function promptRequest() {
  return {
    request_id: "req_test",
    task_type: "text_image",
    prompt: "雨后森林里的小木屋",
    references: [],
    reference_policy: { unbound_entity: "warn" },
    entity_mentions: []
  };
}

function isRagflowConfigInvalid(error) {
  assert.equal(error && error.errorCode, "RAGFLOW_CONFIG_INVALID");
  return true;
}

function isInvalidRequestSchema(error) {
  assert.equal(error && error.errorCode, "INVALID_REQUEST_SCHEMA");
  return true;
}
