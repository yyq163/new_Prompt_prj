const CREDENTIAL_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/\-=]{12,})["']?/gi;
const AUTHORIZATION_BEARER = /\bauthorization\s*:\s*bearer\s+([A-Za-z0-9._~+/\-=]{20,})\b/gi;
const AUTHORIZATION_BASIC = /\bauthorization\s*:\s*basic\s+([A-Za-z0-9+/=]{16,})\b/gi;
const BARE_BEARER = /\bbearer\s+([A-Za-z0-9._~+/\-=]{20,})\b/gi;
const BARE_BASIC = /\bbasic\s+([A-Za-z0-9+/=]{16,})\b/gi;
const COOKIE_HEADER_VALUE = /\bcookie\s*:\s*[^;\s=]{1,80}=[^;\s]{4,}/gi;
const COOKIE_ASSIGNMENT = /\b(?:cookie|session|sessionid|sid|jwt|csrf|xsrf)\b\s*=\s*["']?([A-Za-z0-9._~+/%-]{8,})["']?/gi;
const KNOWN_CREDENTIAL_VALUE = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const BASE64_DATA_URI = /\bdata:[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9._+-]+=[^,;\s]+|;[a-z0-9._+-]+)*;base64,[A-Za-z0-9+/=\s]*/gi;
const LONG_BASE64_CANDIDATE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{80,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;

export function containsHighConfidenceSensitivePayload(value) {
  const text = stringValue(value);
  if (!text) return false;
  if (PRIVATE_KEY_BLOCK.test(text)) return true;
  if (testGlobalPattern(AUTHORIZATION_BEARER, text)) return true;
  if (testGlobalPattern(AUTHORIZATION_BASIC, text)) return true;
  if (testGlobalPattern(BARE_BEARER, text)) return true;
  if (testGlobalPattern(BARE_BASIC, text)) return true;
  if (testGlobalPattern(COOKIE_HEADER_VALUE, text)) return true;
  if (containsCookieAssignment(text)) return true;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, text)) return true;
  if (containsCredentialAssignment(text)) return true;
  if (containsBase64DataUri(text)) return true;
  return containsVerifiableLongBase64(text);
}

function containsCookieAssignment(text) {
  COOKIE_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = COOKIE_ASSIGNMENT.exec(text))) {
    const value = stringValue(match[1]).trim();
    if (value.length >= 16 || shannonEntropy(value) >= 3.0) return true;
  }
  return false;
}

function containsCredentialAssignment(text) {
  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_ASSIGNMENT.exec(text))) {
    if (isLikelyCredentialValue(match[1])) return true;
  }
  return false;
}

function isLikelyCredentialValue(value) {
  const compact = stringValue(value).trim().replace(/^["']|["']$/g, "");
  if (compact.length >= 20) return true;
  return compact.length >= 12 && shannonEntropy(compact) >= 3.2;
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
