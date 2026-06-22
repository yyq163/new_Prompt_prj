import test from "node:test";
import assert from "node:assert/strict";
import {
  containsHighConfidenceSensitivePayload,
  normalizeTextForSensitiveScan,
  scanSensitivePayloadMarkersForTest
} from "../../src/core/sensitive-payload.js";

test("marker scanner returns top-level marker segments without sensitive values", () => {
  const scan = scanSensitivePayloadMarkersForTest(
    "authorization=Custom; authorization=Custom markerCredentialABCDEF1234567890 Cookie: flavor=choco; Cookie: sid=sessionCredentialABCDEF1234567890"
  );
  assert.equal(scan.tooLong, false);
  assert.deepEqual(scan.segments.map((item) => item.type), [
    "authorization",
    "authorization",
    "cookie",
    "cookie"
  ]);
  assert.deepEqual(scan.segments.map((item) => item.separator), ["=", "=", ":", ":"]);
  assert.equal("value" in scan.segments[0], false);
});

test("sensitive payload scanner detects repeated authorization markers on one logical line", () => {
  const credential = "markerCredentialABCDEF1234567890";
  const cases = [
    `authorization=Custom; authorization=Custom ${credential}`,
    `Authorization: Custom; Authorization: Custom ${credential}`,
    `authorization=ApiKey; authorization=ApiKey ${credential}`,
    `Proxy-Authorization: Custom; Proxy-Authorization: Custom ${credential}`,
    `authorization=Token, authorization=Token ${credential}`,
    `authorization=Digest realm="x"; authorization=Digest response="${credential}"`,
    "authorization=Custom; authorization=Custom test_token",
    "Authorization: Custom; Authorization: Custom fake_secret",
    "authorization=ApiKey; authorization=ApiKey sample_api_key",
    `AUTHORIZATION=Custom\tAUTHORIZATION=Custom ${credential}`,
    `ａｕｔｈｏｒｉｚａｔｉｏｎ＝Custom； ａｕｔｈｏｒｉｚａｔｉｏｎ＝Custom ${credential}`,
    `Authori\u2060zation=Custom; Authori\u2060zation=Custom ${credential}`,
    `authorization=Custom; proxy_authorization=Custom ${credential}`,
    `authorization=Custom; authorization=Custom; authorization=Custom ${credential}`,
    `authorization=Custom\nproxy_authorization=Custom ${credential}`
  ];

  for (const value of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value);
  }
});

test("sensitive payload scanner does not split markers inside quoted text", () => {
  const allowed = [
    "请制作一张写有 \"Authorization: Custom\" 的教学图",
    "description=\"文本中出现 Authorization: ApiKey 示例\"",
    "authorization=\"示例文本中写着 Authorization: Token\"",
    "cookie=\"flavor=choco; 文本中出现 cookie=sessionid 示例\"",
    "Cookie: theme=\"dark cookie=sessionid demo\"; layout=grid",
    "\"Authorization: Custom",
    "\"Cookie: flavor=choco",
    "生成一张完整高质量的普通文字生图作品，主题围绕“authorization=\"Token x\", username=\"tester\"”。画面干净。",
    "生成一张完整高质量的普通文字生图作品，主题围绕“生成一张接口教学图，画面文字包括：\"Authorization: Custom”。画面干净。",
    "生成一张完整高质量的普通文字生图作品，主题围绕“生成一张包装标签，画面文字包括：\"Cookie: flavor=choco”。画面干净。",
    "bearer: ceremonial guardian"
  ];

  for (const value of allowed) {
    assert.equal(containsHighConfidenceSensitivePayload(value), false, value);
  }
});

test("sensitive payload scanner rejects quoted and JSON-shaped marker credentials", () => {
  const credential = "markerCredentialABCDEF1234567890";
  const cases = [
    `description="Authorization: ApiKey ${credential}"`,
    `{"Authorization":"Custom ${credential}"}`,
    `{"Proxy-Authorization":"Custom ${credential}"}`,
    `{\\\"Authorization\\\":\\\"Custom ${credential}\\\"}`,
    `{\\\"Proxy-Authorization\\\":\\\"Custom ${credential}\\\"}`,
    `"Cookie: sid=sessionCredentialABCDEF1234567890"`,
    `{"Cookie":"sid=sessionCredentialABCDEF1234567890"}`,
    `{"Set-Cookie":"sessionid=sessionCredentialABCDEF1234567890; HttpOnly"}`,
    `{\\\"Cookie\\\":\\\"sid=sessionCredentialABCDEF1234567890\\\"}`,
    `{\\\"Set-Cookie\\\":\\\"sessionid=sessionCredentialABCDEF1234567890; HttpOnly\\\"}`
  ];

  for (const value of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value);
  }
});

test("marker scanner is quote and escape aware", () => {
  const quoted = scanSensitivePayloadMarkersForTest(
    "description=\"Authorization: Custom\" authorization=\"Custom realm=\\\"Authorization: Token\\\"\"; authorization=Custom markerCredentialABCDEF1234567890"
  );
  assert.deepEqual(quoted.segments.map((item) => item.type), ["authorization", "authorization"]);
  assert.equal(quoted.segments[0].malformed, false);
  assert.equal(quoted.segments[1].malformed, false);

  const malformed = scanSensitivePayloadMarkersForTest(
    "authorization=\"Custom markerCredentialABCDEF1234567890"
  );
  assert.equal(malformed.segments.length, 1);
  assert.equal(malformed.segments[0].malformed, true);
});

test("sensitive payload scanner fails closed on unclosed prefix quotes before markers", () => {
  const credential = "markerCredentialABCDEF1234567890";
  const cases = [
    `"unterminated label Authorization: Custom ${credential}`,
    `'unterminated label Proxy-Authorization: Custom ${credential}`,
    `"unterminated label Cookie: sid=sessionCredentialABCDEF1234567890`,
    `"unterminated label cookie=sessionid=sessionCredentialABCDEF1234567890`,
    `"unterminated label {"Authorization":"Custom ${credential}`,
    `"unterminated label {"Proxy-Authorization":"Custom ${credential}`,
    `"unterminated label {"Cookie":"sid=sessionCredentialABCDEF1234567890`,
    `"unterminated label {"Set-Cookie":"sessionid=sessionCredentialABCDEF1234567890`,
    `'unterminated label {"Authorization":"Custom ${credential}`,
    `'unterminated label {"Proxy-Authorization":"Custom ${credential}`,
    `'unterminated label {"Cookie":"sid=sessionCredentialABCDEF1234567890`,
    `'unterminated label {"Set-Cookie":"sessionid=sessionCredentialABCDEF1234567890`,
    `"unterminated label {\\\"Authorization\\\":\\\"Custom ${credential}`,
    `"unterminated label {\\\"Cookie\\\":\\\"sid=sessionCredentialABCDEF1234567890`
  ];

  for (const value of cases) {
    const scan = scanSensitivePayloadMarkersForTest(value);
    assert.equal(scan.unclosedQuote, true, value);
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value);
  }
});

test("marker scanner handles long bounded inputs without repeated marker backtracking", () => {
  const prefix = "ordinary text ".repeat(300);
  const suffix = " more ordinary text".repeat(300);
  const startedAt = Date.now();
  const scan = scanSensitivePayloadMarkersForTest(`${prefix} authorization=Custom markerCredentialABCDEF1234567890 ${suffix}`);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(scan.tooLong, false);
  assert.equal(scan.segments.length, 1);
  assert.equal(elapsedMs < 200, true);
  assert.equal(containsHighConfidenceSensitivePayload("Ａ".repeat(65 * 1024)), true);
});

test("marker scanner handles repeated JSON-like marker keys in bounded time", () => {
  const repeated = Array.from({ length: 360 }, (_, index) => (
    `{"Authorization":"Custom value${index}"}`
  )).join(" ");
  const startedAt = Date.now();
  const scan = scanSensitivePayloadMarkersForTest(repeated);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(scan.tooLong, false);
  assert.equal(scan.segments.length, 360);
  assert.equal(elapsedMs < 500, true);
  assert.equal(containsHighConfidenceSensitivePayload(repeated), false);
  assert.equal(containsHighConfidenceSensitivePayload("{\"Authorization\":\"Custom value100\"}"), false);
  assert.equal(containsHighConfidenceSensitivePayload("{\"Authorization\":\"Custom markerCredentialABCDEF1234567890\"}"), true);
  assert.equal(containsHighConfidenceSensitivePayload(`{"Authorization":"Custom ${"Q".repeat(16)}!@#$%^&*()"}`), true);
});

test("marker scanner fails closed when segment count exceeds the explicit cap", () => {
  const repeated = Array.from({ length: 580 }, () => (
    "{\"Authorization\":\"x\"}"
  )).join(" ");
  const scan = scanSensitivePayloadMarkersForTest(repeated);
  assert.equal(repeated.length < 16 * 1024, true);
  assert.equal(scan.tooLong, true);
  assert.equal(containsHighConfidenceSensitivePayload(repeated), true);

  const maskedAcrossLines = Array.from({ length: 513 }, () => (
    "\"Authorization: Custom\""
  )).join("\n");
  const maskedScan = scanSensitivePayloadMarkersForTest(maskedAcrossLines);
  assert.equal(maskedScan.tooLong, true);
  assert.equal(containsHighConfidenceSensitivePayload(maskedAcrossLines), true);
});

test("sensitive payload scanner detects repeated cookie markers on one logical line", () => {
  const encodedJwt = "eyJsyntheticJwtHeader123456789%2EeyJsyntheticPayload123456789%2EsyntheticSignature123456789";
  const cases = [
    "cookie=flavor=choco cookie=sessionid=sessionCredentialABCDEF1234567890",
    "cookie=flavor=choco cookie=sessionid=test_token",
    "Cookie: flavor=choco Cookie: auth_token=fake_secret",
    "Set-Cookie: theme=dark Set-Cookie: sessionid=sample_api_key; HttpOnly",
    "Cookie: flavor=choco; Cookie: auth_token=authCredentialABCDEF1234567890",
    "cookie=theme=dark;cookie=access_token=accessCredentialABCDEF1234567890",
    "Cookie: language=zh-CN Cookie: sid=sidCredentialABCDEF1234567890",
    "Set-Cookie: theme=dark; Set-Cookie: sessionid=sessionCredentialABCDEF1234567890; HttpOnly",
    "cookie=flavor=choco cookie=layout=grid cookie=auth=authCredentialABCDEF1234567890",
    "cookie=flavor=choco\tcookie=jwt=eyJsyntheticJwtHeader123456789.eyJsyntheticPayload123456789.syntheticSignature123456789",
    "Cookie: session=abc",
    "cookie=session=abc",
    "Set-Cookie: session=abc; HttpOnly",
    "Cookie: csrf=abc",
    "Cookie: xsrf=abc",
    "Cookie: csrf_token=abc",
    "Cookie: XSRF-TOKEN=abc",
    "Cookie: remember_me=abc",
    "Cookie: oauth=abc",
    "Cookie: oauth_token=abc",
    "Cookie: oauth2_access_token=abc",
    "Cookie: id_token=abc",
    "Cookie: bearer_token=abc",
    "Cookie: session-token=abc",
    "Cookie: session=VALUE",
    "Cookie: token=YOUR_ACCESS_TOKEN",
    "Cookie: csrf=VALUE",
    "cookie=csrf=abc",
    "cookie=oauth=abc",
    "cookie=csrf_token=abc",
    "set_cookie=xsrf=abc",
    "set_cookie=xsrf_token=abc",
    "Set-Cookie: CSRF-TOKEN=abc; HttpOnly",
    "Set-Cookie: oauth=abc; HttpOnly",
    "Cookie: flavor=choco; XSRF-TOKEN=abc",
    "Set-Cookie: remember_me=abc; HttpOnly",
    `Cookie: preference=${encodedJwt}`,
    `cookie=preference=${encodedJwt}`
  ];

  for (const value of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value);
  }
});

test("sensitive payload placeholder grammar is anchored and finite", () => {
  const allowed = [
    "<TOKEN>",
    "<ACCESS_TOKEN>",
    "${ACCESS_TOKEN}",
    "YOUR_ACCESS_TOKEN",
    "ACCESS_TOKEN_PLACEHOLDER",
    "TOKEN_PLACEHOLDER",
    "YOUR_ACCESS_TOKEN_PLACEHOLDER",
    "REPLACE_ME",
    "INSERT_TOKEN_HERE",
    "INSERT_API_KEY_HERE",
    "｛ACCESS_TOKEN｝",
    "生成一张模板说明图，画面文字写 <VALUE> 是用户输入占位符，不是密钥"
  ];
  const rejected = [
    "token=test_token",
    "secret=fake_secret",
    "api_key=sample_api_key",
    "access_token=synthetic_access_token",
    "token=demo_token",
    "token=test_token_ABCDEF1234567890",
    "secret=fake_secret_qwertyuiop123456",
    "api_key=sample_api_key_livevalue123456",
    "access_token=synthetic_access_token_0123456789abcdef",
    "token=demo_token_ABCDEF1234567890",
    "client_secret=fake_client_secret_abcdefghijklmnopqrstuvwxyz",
    "bearer=test_bearer_live_ABCDEF123456789",
    "token=YOUR_ACCESS_TOKEN_ABCDEF1234567890",
    "token=prefix_YOUR_ACCESS_TOKEN",
    `api_key=YOUR_API_KEY_sk-proj-${"E".repeat(32)}`,
    "token=ACCESS_TOKEN_PLACEHOLDER_a8F3kLm9Q2rT6vWx",
    "token=TOKEN_PLACEHOLDER_a8F3kLm9Q2rT6vWx",
    "token=INSERT_TOKEN_HERE_a8F3kLm9Q2rT6vWx",
    "token=REPLACE_ME_a8F3kLm9Q2rT6vWx",
    "<ACCESS_TOKEN>_a8F3kLm9Q2rT6vWxZ7pN",
    "${ACCESS_TOKEN}_a8F3kLm9Q2rT6vWxZ7pN",
    "{ACCESS_TOKEN}_a8F3kLm9Q2rT6vWxZ7pN",
    "<TOKEN>_qwertyuiop123456",
    "${TOKEN}_qwertyuiop123456",
    "<ACCESS_TOKEN>_suffix",
    "${ACCESS_TOKEN}_suffix",
    "{ACCESS_TOKEN}_suffix",
    "<TOKEN>_suffix",
    "authorization=Bearer VALUE",
    "ACCESS_TOKEN_PLACEHOLDER_a8F3kLm9Q2rT6vWx",
    "TOKEN_PLACEHOLDER_a8F3kLm9Q2rT6vWx",
    "INSERT_TOKEN_HERE_a8F3kLm9Q2rT6vWx",
    "REPLACE_ME_a8F3kLm9Q2rT6vWx",
    "YOUR_ACCESS_TOKEN_ABCDEF1234567890",
    `YOUR_API_KEY_sk-proj-${"E".repeat(32)}`,
    "prefix_YOUR_ACCESS_TOKEN",
    "test_token_ABCDEF1234567890",
    "fake_secret_qwertyuiop123456",
    "sample_api_key_livevalue123456"
  ];

  for (const value of allowed) {
    assert.equal(containsHighConfidenceSensitivePayload(value), false, value);
  }
  for (const value of rejected) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value);
  }
});

test("authorization parameter bounds cover token-style parameter names", () => {
  const manyDigitLeadingParameters = Array.from({ length: 33 }, (_, index) => `${index}=a`).join("; ");
  const cases = [
    `authorization=Digest realm="x"; ${manyDigitLeadingParameters}`,
    `authorization=Token x, 1="${"v".repeat(2049)}"`,
    `authorization=Token x, x.param="${"v".repeat(2049)}"`,
    `authorization=Token x, x+param="${"v".repeat(2049)}"`,
    `authorization=Custom; foo="markerCredentialABCDEF1234567890"`,
    `authorization=AWS4-HMAC-SHA256, XCustom="markerCredentialABCDEF1234567890"`,
    `authorization=Digest realm="x"; unknown="markerCredentialABCDEF1234567890"`,
    `authorization=Bearer abc12345`,
    `authorization=Basic dTpw`,
    `authorization=Token abcdefgh`,
    `authorization=ApiKey abcdefgh`,
    `authorization=XCustom abcdefghijk`,
    `Authorization: Foo abcdefghijk`,
    `Proxy-Authorization: Token abcdefgh`,
    `Proxy-Authorization: ApiKey abcdefgh`,
    `Proxy-Authorization: Bar abcdefghijk`,
    `proxy_authorization=Fancy abc12345`,
    `authorization=Custom; authorization=Custom abc12345`
  ];

  for (const value of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, value.slice(0, 120));
  }

  const allowed = [
    "authorization=\"Token x\", username=\"testuser\"",
    "authorization=\"Token x\", realm=\"public01\"",
    "authorization=\"Token x\", algorithm=\"hmac-sha\"",
    "authorization=\"Digest x\"; realm=\"public01\"; qop=\"auth\"",
    "proxy_authorization=\"Custom x\"; username=\"testuser\""
  ];
  for (const value of allowed) {
    assert.equal(containsHighConfidenceSensitivePayload(value), false, value);
  }
});

test("sensitive scan normalization keeps repeated fullwidth markers detectable", () => {
  assert.equal(
    normalizeTextForSensitiveScan("ａｕｔｈｏｒｉｚａｔｉｏｎ＝Custom").includes("authorization=Custom"),
    true
  );
  assert.equal(containsHighConfidenceSensitivePayload("İ Authorization: Custom markerCredentialABCDEF1234567890"), true);
  assert.equal(containsHighConfidenceSensitivePayload("İ Cookie: sid=sessionCredentialABCDEF1234567890"), true);
});
