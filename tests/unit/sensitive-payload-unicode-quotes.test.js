import test from "node:test";
import assert from "node:assert/strict";
import { containsHighConfidenceSensitivePayload } from "../../src/core/sensitive-payload.js";

// Regression tests for the unicode-quote / ideographic-full-stop truncation bug.
// trimNarrativeMarkerValue (and the secondary trim* helpers) currently cut marker
// values at [“”‘’。] BEFORE credential detection, which lets real credentials
// smuggled after one of those terminators escape detection. The cases below pin
// the leaking inputs (must become detected) and the ASCII-separator controls
// (already detected, proving only the punctuation differs), plus teaching-text
// guards (must stay undetected) and fullwidth-normalized guards (already detected).

test("scanner detects authorization response credentials split by ideographic full stop", () => {
  const response = "syntheticRESPvalue000";
  const cases = [
    ["L1 ideographic full stop after unquoted realm", `Authorization: Digest realm=x\u3002response="${response}"`],
    ["L2 ideographic full stop after quoted realm", `Authorization: Digest realm="x"\u3002response="${response}"`],
    ["L3 ideographic full stop after scheme", `Authorization: Digest\u3002response="${response}"`],
    ["L4 curly double quotes around teaching realm then full stop", `Authorization: Digest realm=\u201cteaching\u201d\u3002response="${response}"`],
    ["L11 Bearer scheme then ideographic full stop", `Authorization: Bearer x\u3002response=${response}`],
    ["D1 discriminating truncated remainder still detects response credential", `Authorization: Digest realm=\u3002response="${response}"`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("scanner detects cookie credentials split by ideographic full stop", () => {
  const session = "syntheticSESSIONidAAA";
  const cases = [
    ["L5 Cookie pair split by ideographic full stop", `Cookie: a=b\u3002sessionid=${session}`],
    ["L6 Set-Cookie pair split by ideographic full stop", `Set-Cookie: a=b\u3002sessionid=${session}`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("scanner detects bearer credentials whose prefix token is wrapped in curly quotes", () => {
  const response = "syntheticRESPvalue000";
  const cases = [
    ["L7 Bearer with curly open/close double quotes", `Authorization: Bearer \u201cx\u201dresponse=${response}`],
    ["L8 Bearer with curly close/open double quotes", `Authorization: Bearer \u201dx\u201dresponse=${response}`],
    ["L9 Bearer with curly open/close single quotes", `Authorization: Bearer \u2018x\u2019response=${response}`],
    ["L10 Bearer with curly close/open single quotes", `Authorization: Bearer \u2018x\u2019response=${response}`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("ASCII-separator controls stay detected, proving only the punctuation differs", () => {
  const response = "syntheticRESPvalue000";
  const session = "syntheticSESSIONidAAA";
  const cases = [
    ["C1 ASCII semicolon separator", `Authorization: Digest realm=x; response="${response}"`],
    ["C2 ASCII space separator", `Authorization: Bearer x response=${response}`],
    ["C3 Cookie ASCII semicolon separator", `Cookie: a=b; sessionid=${session}`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("fullwidth-normalized inputs that already work keep returning detected", () => {
  const cases = [
    ["W1 fullwidth semicolon already normalized", "Set-Cookie: theme='dark'\uff1baccess_token=syntheticTOKENbbb"],
    ["W2 fullwidth comma already normalized", "Proxy-Authorization: Basic realm=\"x\"\uff0ccredential=\"syntheticPROXYcred\""],
    ["W3 fullwidth colon header already normalized", "Proxy-Authorization\uff1aBasic realm=\"x\"\uff1bcredential=\"syntheticPROXYcred2\""]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("legitimate teaching text with curly quotes and ideographic full stop stays undetected", () => {
  const cases = [
    ["T1 teaching example with curly quotes", "教学示例：“当用户输入‘你好’，系统应回答‘你好，世界’。”"],
    ["T2 teaching cookie format prose", "讲解：Cookie 头格式为 name=value；多个用分号分隔。"],
    ["T3 teaching authorization placeholder prose", "说明：Authorization: Bearer <token> 是占位符示例，非真实凭证。"]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), false, label);
  }
});

// Reviewer-found unicode/punctuation boundary gaps. Independent review surfaced
// ADDITIONAL fail-open gaps (G1..G6) and false positives (F1..F3) in the SAME
// curly-quote / Chinese-punctuation boundary targeted by this file. These pin
// the correct desired behavior so the Builder can close them. All inputs are
// PRE-EXISTING (they fail on the baseline too) but sit in the unicode/
// punctuation security boundary this task owns.

test("reviewer-found unicode/punctuation boundary gaps", () => {
  const response = "syntheticRESPvalue000XYZ123";
  const session = "syntheticSESSIONidAAA";
  // P2/P3 fail-open gaps: must become detected=true (currently leak).
  const mustDetect = [
    // G1: AUTH_PARAM_CREDENTIAL regex lacks sessionid/session, so a sessionid
    // credential smuggled after 。 on an Authorization header escapes detection.
    ["G1 authorization sessionid after ideographic full stop", `Authorization: Bearer x\u3002sessionid=${session}`],
    // G2: curly quotes are treated as terminators, not delimiters, so a bare
    // bearer token wrapped in curly double quotes escapes the BARE_BEARER scan.
    ["G2 bearer bare token wrapped in curly double quotes", `Authorization: Bearer \u201c${response}\u201d`],
    // G2 (single-quote variant): same root cause with curly single quotes.
    ["G2b bearer bare token wrapped in curly single quotes", `Authorization: Bearer \u2018${response}\u2019`],
    // G3: splitCookieSegments only splits on ; and 。, so U+3001 ideographic
    // comma does NOT separate cookie pairs and a sessionid pair leaks.
    ["G3 cookie pair split by ideographic comma U+3001", `Cookie: a=b\u3001sessionid=${session}`],
    // G4: U+FF0C fullwidth comma normalizes to ASCII , via NFKC, but
    // splitCookieSegments still does not split on ASCII comma, so the second
    // pair leaks (the COOKIE path is not covered by the AUTH-path normalization).
    ["G4 cookie pair split by fullwidth comma U+FF0C", `Cookie: a=b\uFF0Csessionid=${session}`],
    // G5: fullValue is sliced at MAX_COOKIE_VALUE_CHARS (4096) but tooLong is
    // computed on the trimmed `value`, so an oversized cookie whose real
    // sessionid pair lands just past 4096 is dropped instead of failing closed.
    ["G5 oversized cookie window drops post-ideographic-full-stop credential", `Cookie: ${"a".repeat(4090)}=x\u3002sessionid=${session}`],
    // G6: canonicalAuthorizationParameterName strips non-ASCII, so a Cyrillic o
    // (U+043E) in "respоnse" canonicalizes to "respnse" != "response" and the
    // homoglyph param value escapes the sensitive-parameter credential check.
    ["G6 homoglyph response param with Cyrillic o", `Authorization: Digest realm=x; resp\u043Ense="${response}"`]
  ];
  for (const [label, value] of mustDetect) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }

  // P3 false positives: must become detected=false (currently over-fire on
  // teaching/placeholder text). Do NOT weaken real credential detection to do
  // this; the Builder must narrow the heuristics so teaching copy is not flagged.
  const mustNotDetect = [
    // F1: ，-joined prose after a <token> placeholder should not flag as a
    // credential (the trailing clause is natural-language explanation).
    ["F1 teaching prose joined by fullwidth comma after placeholder", "API 文档说明：调用接口时在请求头加上 Authorization: Bearer <token>，其中 token 是你在控制台获取的访问令牌。"],
    // F2: a trailing ASCII period directly after a <ACCESS_TOKEN> placeholder
    // should not turn the placeholder into a detected credential.
    ["F2 trailing ASCII period after placeholder", "Authorization: Bearer <ACCESS_TOKEN>."],
    // F3: a param-name placeholder value <RESPONSE> (not a real secret) should
    // not be treated as a sensitive response credential.
    ["F3 param-name placeholder value in response parameter", `Authorization: Digest realm="api", response="<RESPONSE>"\u3002`]
  ];
  for (const [label, value] of mustNotDetect) {
    assert.equal(containsHighConfidenceSensitivePayload(value), false, label);
  }
});

// Reviewer-found Cyrillic homoglyph gap (A13). Independent review surfaced a
// missing-coverage gap: no test exercised Cyrillic confusables inside the
// param/cookie NAME on the 。/curly-quote fullScanValue path (the path that
// runs containsCredentialParameter / containsCookieCredentialParameter over
// item.fullScanValue). The fix scans a normalizeCyrillicHomoglyphs copy, so a
// Cyrillic o (U+043E) in "sessiоnid"/"respоnse"/"tоken" must still be detected.
// These cases use 。 (or 、) as the pair separator so the fullScanValue regex
// path is exercised, NOT the ;-delimited canonicalAuthorizationParameterName
// path (which strips non-ASCII and would otherwise canonicalize away the
// homoglyph before the credential check).

test("scanner detects Cyrillic homoglyph credential names on the fullScanValue path", () => {
  const session = "syntheticSESSIONidAAA";
  const response = "syntheticRESPvalue000XYZ123";
  const token = "opaqueSessionIdValueXYZ123456789";
  // H1-H4: must become detected=true. Each uses a Cyrillic o (U+043E) inside
  // the param/cookie NAME and a 。 / 、 separator, exercising the fullScanValue
  // regex path (containsCredentialParameter / containsCookieCredentialParameter
  // scan a normalizeCyrillicHomoglyphs copy), NOT the ;-canonical path.
  const cases = [
    // H1: Cyrillic о in "sessiоnid", 。 separator -> fullScanValue regex path.
    ["H1 cookie sessiоnid (Cyrillic o) after ideographic full stop", `Cookie: a=b\u3002sessi\u043Enid=${session}`],
    // H2: Cyrillic о in "respоnse", 。 separator -> fullScanValue regex path.
    ["H2 digest respоnse (Cyrillic o) after ideographic full stop", `Authorization: Digest realm=x\u3002resp\u043Ense="${response}"`],
    // H3: Cyrillic о in "tоken", 。 separator -> fullScanValue regex path.
    ["H3 cookie tоken (Cyrillic o) after ideographic full stop", `Cookie: a=b\u3002t\u043Eken=${token}`],
    // H4: Cyrillic о in "sessiоnid", 、 (U+3001) separator -> fullScanValue regex path.
    ["H4 cookie sessiоnid (Cyrillic o) after ideographic comma U+3001", `Cookie: a=b\u3001sessi\u043Enid=${session}`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

// Round-1 auditor findings: 3 NEW fail-open gaps (F1..F3) verified to currently
// return false (leak). These pin the correct desired behavior so the Builder
// can close them. All inputs are PRE-EXISTING fail-open cases in the same
// newline / homoglyph / zero-width boundary this file owns.

test("scanner detects newline-smuggled and homoglyph-concatenated credential gaps (round 1)", () => {
  // F1 (P0 newline smuggling): a literal \n inside the Authorization marker line
  // splits the line so the response= hash lands on a BARE line with no
  // "Authorization" prefix and escapes the per-line marker scanner. Must become
  // detected=true (currently false).
  const f1 = "Authorization: Digest realm=\"x\"\nresponse=deadbeefcafebabe1234567890abcdef";
  assert.equal(containsHighConfidenceSensitivePayload(f1), true, "F1 newline-smuggled digest response hash");

  // F2 (P0/P1 Cyrillic homoglyph on concatenated cookie names): the cookie name
  // match is latin-only, so a Cyrillic-\u043E (o) homoglyph in a token-bearing
  // cookie name escapes detection while the latin variant is caught. For each
  // name the Cyrillic-\u043E variant must become detected=true (latin is the
  // control, already true).
  const names = ["csrftoken","xsrftoken","authtoken","accesstoken","refreshtoken","sessiontoken","bearertoken","idtoken"];
  for (const name of names) {
    const cyrname = name.replace(/o/, "\u043E");
    const cyr = `Cookie: a=b; ${cyrname}=syntheticSECRETvalue00`;
    const latin = `Cookie: a=b; ${name}=syntheticSECRETvalue00`;
    assert.equal(containsHighConfidenceSensitivePayload(cyr), true, `F2 cyrillic cookie name ${cyrname}`);
    assert.equal(containsHighConfidenceSensitivePayload(latin), true, `F2 control latin cookie name ${name}`);
  }
  // F2 separator variants for csrftoken cyrillic: \u3002 (。) and \u3001 (、).
  const csrfCyr = "csrft\u043Eken";
  assert.equal(containsHighConfidenceSensitivePayload(`Cookie: a=b\u3002${csrfCyr}=syntheticSECRETvalue00`), true, "F2 csrftoken cyrillic after ideographic full stop");
  assert.equal(containsHighConfidenceSensitivePayload(`Cookie: a=b\u3001${csrfCyr}=syntheticSECRETvalue00`), true, "F2 csrftoken cyrillic after ideographic comma U+3001");

  // F3 (P2 ZWSP in cookie name yielding non-name): a zero-width space (U+200B)
  // inside "sessi\u200Bid" makes the concatenated name not match "sessionid",
  // so the sessionid value escapes detection. Must become detected=true.
  const f3 = "Cookie: sessi\u200Bid=syntheticSESSIONidAAA";
  assert.equal(containsHighConfidenceSensitivePayload(f3), true, "F3 ZWSP-split cookie sessionid");
});

// Round-1 Part C audit gap G4: combination (multi-vector) and malformed-quote
// tests. These exercise 2+ historical findings at once (newline+homoglyph,
// oversized+homoglyph, placeholder+credential-after-terminator, multi-separator,
// curly+ideographic-comma) plus escaped/mismatched quote states, so regressions
// in any single vector cannot quietly re-open a combination smuggling path.

test("scanner detects multi-vector combination credential smuggling (round 1 G4)", () => {
  // 32-hex Digest response hash (real Digest shape) so the newline+homoglyph
  // bare-line case is caught by the strict 32+hex value gate.
  const response = "deadbeefcafebabe1234567890abcdef";
  const session = "syntheticSESSIONidAAA";
  const cases = [
    // newline + Cyrillic homoglyph: response= split to a bare line, with Cyrillic о.
    ["newline+homoglyph", `Authorization: Digest realm="x"\nresp\u043Ense="${response}"`],
    // oversized cookie window + Cyrillic homoglyph after ideographic full stop.
    ["oversized+homoglyph", `Cookie: ${"a".repeat(4090)}=x\u3002sessi\u043Enid=${session}`],
    // placeholder scheme value + real credential after an ideographic terminator.
    ["placeholder+credential-after-terminator", `Authorization: Bearer <token>\u3002sessionid=${session}`],
    // multi-separator chain: ；(NFKC->;) + 。 + ，(NFKC->,) + two Cyrillic homoglyph names.
    ["multi-separator", `Cookie: a=b\uff1bsessionid=x\u3002resp\u043Ense="y"\uff0ct\u043Eken=z`],
    // curly-quoted bearer token + ideographic comma + trailing response=.
    ["curly+ideographic-comma", `Authorization: Bearer \u201c${response}XYZ123\u201d\uff0creponse="more"`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});

test("scanner detects credentials inside escaped and mismatched quote states", () => {
  const response = "syntheticRESPvalue000";
  const session = "syntheticSESSIONidAAA";
  const cases = [
    // escaped ASCII quote mid-value: Bearer "x\" then a response= credential.
    ["escaped quote mid-value", `Authorization: Bearer "x\\" response=${response}`],
    // mismatched/unclosed quote: Cookie value opens a quote, never closes, then
    // sessionid= follows after an ideographic full stop.
    ["mismatched unclosed quote", `Cookie: a="b;c\u3002sessionid=${session}`]
  ];
  for (const [label, value] of cases) {
    assert.equal(containsHighConfidenceSensitivePayload(value), true, label);
  }
});
