const CREDENTIAL_ASSIGNMENT = /\b(proxy[_-]?authorization|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password)\b\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|([^\s,;]{8,}))/giu;
const AUTHORIZATION_HEADER_VALUE = /\b(?:proxy-authorization|authorization)\s*:\s*([^\r\n]+)/giu;
const BARE_BEARER = /\bbearer\s+([A-Za-z0-9._~+/\-=]{20,})\b/giu;
const BARE_BASIC = /\bbasic\s+([A-Za-z0-9+/=]{16,})\b/giu;
const COOKIE_HEADER_VALUE = /\b(?:set-cookie|cookie)\s*:\s*([^\r\n]+)/giu;
const COOKIE_ASSIGNMENT = /\b(?:cookie|session|sessionid|sid|jwt|csrf|xsrf)\b\s*=\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|([^;\s,]{8,}))/giu;
const KNOWN_CREDENTIAL_VALUE = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const BASE64_DATA_URI = /\bdata:[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9._+-]+=[^,;\s]+|;[a-z0-9._+-]+)*;base64,[A-Za-z0-9+/=\s]*/gi;
const LONG_BASE64_CANDIDATE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{80,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const AUTH_SCHEME = /^[A-Za-z][A-Za-z0-9._+-]{0,63}$/u;
const AUTH_PARAM_CREDENTIAL = /\b(?:response|signature|credential|token|key|secret|password|access_token|client_secret)\s*=\s*"?([^",\s]{8,})"?/giu;
const TEACHING_CONTEXT = /教学|示例|占位|占位符|说明|语法|格式|流程|不是|非真实|not\s+real|placeholder|example|sample|dummy/iu;
const PLACEHOLDER_CREDENTIAL = /^(?:[<{[]?\s*)?(?:(?:your|replace|replace_me|placeholder|example|sample|dummy|fake|test)(?:[\s_:-]*(?:token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|password|cookie|session|value|bearer))*|(?:token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|password|cookie|session|value|bearer)[\s_:-]*(?:placeholder|example|sample|dummy|fake|test))\s*(?:[>}\]]?)$/iu;

export function containsHighConfidenceSensitivePayload(value) {
  const text = stringValue(value);
  if (!text) return false;
  if (PRIVATE_KEY_BLOCK.test(text)) return true;
  if (containsAuthorizationHeader(text)) return true;
  if (containsBareAuthCredential(BARE_BEARER, text)) return true;
  if (containsBareAuthCredential(BARE_BASIC, text)) return true;
  if (containsCookieHeader(text)) return true;
  if (containsCookieAssignment(text)) return true;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, text)) return true;
  if (containsCredentialAssignment(text)) return true;
  if (containsBase64DataUri(text)) return true;
  return containsVerifiableLongBase64(text);
}

function containsAuthorizationHeader(text) {
  AUTHORIZATION_HEADER_VALUE.lastIndex = 0;
  let match;
  while ((match = AUTHORIZATION_HEADER_VALUE.exec(text))) {
    const headerValue = firstHeaderExampleSegment(stripOuterQuotes(match[1]));
    if (!headerValue) continue;
    const parts = headerValue.match(/^([A-Za-z][A-Za-z0-9._+-]{0,63})(?:\s+(.+))?$/u);
    if (!parts) {
      if (isLikelyCredentialValue(headerValue)) return true;
      continue;
    }
    const scheme = parts[1];
    const credential = stripOuterQuotes(parts[2] || "");
    if (!AUTH_SCHEME.test(scheme) || !credential) continue;
    if (containsCredentialParameter(credential)) return true;
    if (TEACHING_CONTEXT.test(headerValue) && !containsLikelyCredentialToken(credential)) continue;
    if (isLikelyCredentialValue(credential)) return true;
  }
  return false;
}

function containsBareAuthCredential(pattern, text) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (isLikelyCredentialValue(match[1])) return true;
  }
  return false;
}

function containsCredentialParameter(value) {
  AUTH_PARAM_CREDENTIAL.lastIndex = 0;
  let match;
  while ((match = AUTH_PARAM_CREDENTIAL.exec(value))) {
    if (isLikelyCredentialValue(match[1])) return true;
  }
  return false;
}

function containsCookieAssignment(text) {
  COOKIE_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = COOKIE_ASSIGNMENT.exec(text))) {
    const value = stringValue(match[1] || match[2] || match[3]).trim();
    if (isPlaceholderCredential(value)) continue;
    if (value.length >= 16 || shannonEntropy(value) >= 3.0) return true;
  }
  return false;
}

function containsCookieHeader(text) {
  COOKIE_HEADER_VALUE.lastIndex = 0;
  let match;
  while ((match = COOKIE_HEADER_VALUE.exec(text))) {
    const headerValue = firstHeaderExampleSegment(match[1]);
    const teachingExample = TEACHING_CONTEXT.test(headerValue);
    const pairs = headerValue.split(";").map((item) => item.trim()).filter(Boolean);
    for (const pair of pairs) {
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const value = stripOuterQuotes(pair.slice(separator + 1));
      if (isPlaceholderCredential(value)) continue;
      if (isLikelyCredentialValue(value)) return true;
      if (!teachingExample && value.length >= 4) return true;
    }
  }
  return false;
}

function firstHeaderExampleSegment(value) {
  return stringValue(value).split(/[。；，、]/u)[0].trim();
}

function containsCredentialAssignment(text) {
  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_ASSIGNMENT.exec(text))) {
    const key = match[1];
    const value = stringValue(match[2] || match[3] || match[4]).trim();
    if (!value || isPlaceholderCredential(value)) continue;
    if (isAuthorizationAssignmentKey(key) && containsAssignedAuthorizationCredential(value)) return true;
    if (isLikelyCredentialValue(value)) return true;
    if (isCredentialAssignmentValue(value)) return true;
  }
  return false;
}

function isAuthorizationAssignmentKey(key) {
  const canonical = stringValue(key).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return canonical === "authorization" || canonical === "proxyauthorization";
}

function containsAssignedAuthorizationCredential(value) {
  const compact = stripOuterQuotes(value).trim();
  if (!compact) return false;
  const segment = firstHeaderExampleSegment(compact);
  if (containsCredentialParameter(segment)) return true;
  const parts = segment.match(/^([A-Za-z][A-Za-z0-9._+-]{0,63})(?:\s+(.+))?$/u);
  if (!parts) return isCredentialAssignmentValue(segment);
  const credential = stripOuterQuotes(parts[2] || "");
  if (!AUTH_SCHEME.test(parts[1]) || !credential || isPlaceholderCredential(credential)) return false;
  if (TEACHING_CONTEXT.test(segment) && !containsLikelyCredentialToken(credential)) return false;
  return isLikelyCredentialValue(credential) || isCredentialAssignmentValue(credential);
}

function isCredentialAssignmentValue(value) {
  const compact = stripOuterQuotes(value).trim();
  if (!compact || isPlaceholderCredential(compact)) return false;
  if (TEACHING_CONTEXT.test(compact) && !containsLikelyCredentialToken(compact)) return false;
  const alnumCount = (compact.match(/[A-Za-z0-9]/gu) || []).length;
  return compact.length >= 8 && alnumCount >= 6;
}

function isLikelyCredentialValue(value) {
  const compact = stripOuterQuotes(value).trim();
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, compact)) return true;
  if (isPlaceholderCredential(compact)) return false;
  if (/\s/u.test(compact)) return containsLikelyCredentialToken(compact);
  if (compact.length >= 20) return true;
  return compact.length >= 12 && shannonEntropy(compact) >= 3.2;
}

function containsLikelyCredentialToken(value) {
  const parts = stringValue(value)
    .split(/[\s,;]+/u)
    .map((part) => stripOuterQuotes(part).replace(/^[^\w]+|[^\w=+/_~.-]+$/gu, ""))
    .filter(Boolean);
  return parts.some((part) => {
    if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, part)) return true;
    if (isPlaceholderCredential(part)) return false;
    if (part.length >= 20 && /[A-Za-z0-9]/u.test(part)) return true;
    return part.length >= 12 && /[A-Za-z0-9]/u.test(part) && shannonEntropy(part) >= 3.2;
  });
}

function isPlaceholderCredential(value) {
  const compact = stripOuterQuotes(value)
    .trim()
    .replace(/^<|>$/gu, "")
    .replace(/^\{|\}$/gu, "")
    .replace(/^\[|\]$/gu, "");
  if (!compact) return false;
  if (PLACEHOLDER_CREDENTIAL.test(compact)) return true;
  const normalized = compact
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!normalized) return false;
  const tokens = normalized.split("_").filter(Boolean);
  const placeholderWords = new Set(["YOUR", "REPLACE", "REPLACEME", "PLACEHOLDER", "EXAMPLE", "SAMPLE", "DUMMY", "FAKE", "TEST"]);
  const credentialWords = new Set(["TOKEN", "KEY", "SECRET", "PASSWORD", "COOKIE", "VALUE", "SESSION", "ACCESS", "REFRESH", "API", "CLIENT", "AUTH", "BEARER"]);
  if (tokens.some((token) => placeholderWords.has(token)) && tokens.some((token) => credentialWords.has(token))) return true;
  return /^(?:YOUR|REPLACE|PLACEHOLDER|EXAMPLE|SAMPLE|DUMMY)[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE|VALUE)$/u.test(normalized);
}

function stripOuterQuotes(value) {
  const text = stringValue(value).trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function containsBase64DataUri(text) {
  BASE64_DATA_URI.lastIndex = 0;
  return BASE64_DATA_URI.test(text);
}

function containsVerifiableLongBase64(text) {
  LONG_BASE64_CANDIDATE.lastIndex = 0;
  let match;
  while ((match = LONG_BASE64_CANDIDATE.exec(text))) {
    const compact = match[1].replace(/\s+/g, "");
    const decoded = decodeBase64Strict(compact);
    if (!decoded) continue;
    if (decoded.length >= 48) return true;
  }
  return false;
}

function decodeBase64Strict(value) {
  const compact = stringValue(value).trim();
  if (compact.length < 80 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, "base64");
    if (!decoded.length) return null;
    const encoded = decoded.toString("base64").replace(/=+$/g, "");
    if (encoded !== compact.replace(/=+$/g, "")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function shannonEntropy(text) {
  if (!text) return 0;
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function testGlobalPattern(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
