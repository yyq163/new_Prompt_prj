const CREDENTIAL_ASSIGNMENT = /\b(proxy[_-]?authorization|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password)\b\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|([^\s,;]{8,}))/giu;
const BARE_BEARER = /\bbearer\s+([A-Za-z0-9._~+/\-=]{20,})\b/giu;
const BARE_BASIC = /\bbasic\s+([A-Za-z0-9+/=]{16,})\b/giu;
const COOKIE_HEADER_VALUE = /\b(set-cookie|cookie)\s*:\s*([^\r\n]+)/giu;
const COOKIE_ASSIGNMENT_KEY = /(^|[^A-Za-z0-9_-])(set[-_]?cookie|cookie|session|sessionid|sid|jwt|csrf|xsrf|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|credential|api[_-]?key)\b\s*=\s*/giu;
const KNOWN_CREDENTIAL_VALUE = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const BASE64_DATA_URI = /\bdata:[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9._+-]+=[^,;\s]+|;[a-z0-9._+-]+)*;base64,[A-Za-z0-9+/=\s]*/gi;
const LONG_BASE64_CANDIDATE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{80,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const AUTH_SCHEME = /^[A-Za-z][A-Za-z0-9._+-]{0,63}$/u;
const AUTH_PARAM_CREDENTIAL = /\b(?:response|signature|credential|token|key|secret|password|access_token|client_secret)\s*=\s*"?([^",\s]{8,})"?/giu;
const AUTH_ASSIGNMENT_KEY = /(^|[^A-Za-z0-9_-])(proxy[-_]?authorization|authorization)\s*([:=])/giu;
const TEACHING_CONTEXT = /教学|示例|占位|占位符|说明|语法|格式|流程|文案|产品|包装|不是|非真实|not\s+real|placeholder|example|sample|dummy/iu;
const PLACEHOLDER_CREDENTIAL = /^(?:[<{[]?\s*)?(?:(?:your|replace|replace_me|placeholder|example|sample|dummy|fake|test)(?:[\s_:-]*(?:token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|password|cookie|session|value|bearer))*|(?:token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|password|cookie|session|value|bearer)[\s_:-]*(?:placeholder|example|sample|dummy|fake|test))\s*(?:[>}\]]?)$/iu;
const DEFAULT_IGNORABLE_AND_FORMAT_CONTROLS = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const FULLWIDTH_PUNCTUATION = /[：﹕꞉︓]/gu;
const FULLWIDTH_EQUALS = /[＝﹦]/gu;
const MAX_AUTHORIZATION_VALUE_CHARS = 4096;
const MAX_AUTHORIZATION_PARAMETERS = 32;
const MAX_AUTHORIZATION_PARAMETER_VALUE_CHARS = 2048;
const MAX_COOKIE_VALUE_CHARS = 4096;

export function containsHighConfidenceSensitivePayload(value) {
  const original = stringValue(value);
  const normalized = normalizeTextForSensitiveScan(original);
  const candidates = original === normalized ? [original] : [original, normalized];
  return candidates.some((text) => containsSensitivePayloadInText(text));
}

export function normalizeTextForSensitiveScan(value) {
  return stringValue(value)
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE_AND_FORMAT_CONTROLS, "")
    .replace(FULLWIDTH_PUNCTUATION, ":")
    .replace(FULLWIDTH_EQUALS, "=");
}

function containsSensitivePayloadInText(text) {
  if (!text) return false;
  if (PRIVATE_KEY_BLOCK.test(text)) return true;
  if (containsAuthorizationHeader(text)) return true;
  if (containsAuthorizationAssignment(text)) return true;
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
  for (const item of extractAuthorizationValues(text, new Set([":"]))) {
    if (item.tooLong) return true;
    if (item.malformed) return true;
    if (item.tooManyParameters) return true;
    if (containsAssignedAuthorizationCredential(item.value)) return true;
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

function containsAuthorizationAssignment(text) {
  for (const item of extractAuthorizationValues(text, new Set(["="]))) {
    if (item.tooLong) return true;
    if (item.malformed) return true;
    if (item.tooManyParameters) return true;
    const value = stringValue(item.value).trim();
    if (!value || isPlaceholderCredential(value)) continue;
    if (containsAssignedAuthorizationCredential(value)) return true;
  }
  return false;
}

function containsCookieAssignment(text) {
  for (const line of logicalLines(text)) {
    COOKIE_ASSIGNMENT_KEY.lastIndex = 0;
    let match;
    while ((match = COOKIE_ASSIGNMENT_KEY.exec(line))) {
      const key = match[2];
      const parsed = parseAssignmentValueAt(line, COOKIE_ASSIGNMENT_KEY.lastIndex, MAX_COOKIE_VALUE_CHARS);
      if (parsed.tooLong) return true;
      if (containsCookieAssignmentCredential(key, parsed.value)) return true;
      COOKIE_ASSIGNMENT_KEY.lastIndex = Math.max(COOKIE_ASSIGNMENT_KEY.lastIndex + 1, parsed.end);
    }
  }
  return false;
}

function containsCookieHeader(text) {
  COOKIE_HEADER_VALUE.lastIndex = 0;
  let match;
  while ((match = COOKIE_HEADER_VALUE.exec(text))) {
    const headerName = stringValue(match[1]).toLowerCase();
    const headerValue = boundedHeaderValue(match[2]);
    const pairs = parseCookiePairs(headerValue, headerName === "set-cookie");
    for (const pair of pairs) {
      if (isHighConfidenceCookieCredential(pair.name, pair.value)) return true;
    }
  }
  return false;
}

function containsCredentialAssignment(text) {
  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_ASSIGNMENT.exec(text))) {
    const key = match[1];
    const value = stringValue(match[2] || match[3] || match[4]).trim();
    if (!value || isPlaceholderCredential(value)) continue;
    if (isAuthorizationAssignmentKey(key)) {
      if (containsAssignedAuthorizationCredential(value)) return true;
      continue;
    }
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
  const compact = stringValue(value).trim();
  if (!compact) return false;
  const segment = unescapeScanQuotes(compact);
  if (containsCredentialParameter(segment)) return true;
  const primarySegment = firstAuthorizationSegment(segment);
  const parts = primarySegment.match(/^([A-Za-z][A-Za-z0-9._+-]{0,63})(?:\s+(.+))?$/u);
  if (!parts) return isCredentialAssignmentValue(segment);
  const credential = stripOuterQuotes(parts[2] || "");
  if (!AUTH_SCHEME.test(parts[1])) return isCredentialAssignmentValue(primarySegment);
  if (!credential) {
    if (isKnownAuthorizationScheme(parts[1])) return false;
    return isLikelyCredentialValue(primarySegment) || isCredentialAssignmentValue(primarySegment);
  }
  if (isPlaceholderCredential(credential)) {
    return primarySegment === segment ? false : isCredentialAssignmentValue(primarySegment);
  }
  if (TEACHING_CONTEXT.test(primarySegment) && !containsLikelyCredentialToken(credential)) return false;
  return isLikelyCredentialValue(credential) || isCredentialAssignmentValue(credential);
}

function isKnownAuthorizationScheme(value) {
  return new Set([
    "apikey",
    "aws4-hmac-sha256",
    "basic",
    "bearer",
    "custom",
    "digest",
    "token"
  ]).has(stringValue(value).toLowerCase());
}

function unescapeScanQuotes(value) {
  return stringValue(value).replace(/\\(["'])/g, "$1");
}

function firstAuthorizationSegment(value) {
  let quote = "";
  let escaped = false;
  let segment = "";
  for (const char of stringValue(value)) {
    if (escaped) {
      segment += char;
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      segment += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      segment += char;
      quote = char;
      continue;
    }
    if (char === "," || char === ";") break;
    segment += char;
  }
  return stripOuterQuotes(segment.trim()).trim();
}

function extractAuthorizationValues(text, allowedSeparators) {
  const values = [];
  for (const line of logicalLines(text)) {
    AUTH_ASSIGNMENT_KEY.lastIndex = 0;
    let match;
    while ((match = AUTH_ASSIGNMENT_KEY.exec(line))) {
      const separator = match[3];
      if (!allowedSeparators.has(separator)) continue;
      const parsed = parseAuthorizationLogicalValueAt(line, AUTH_ASSIGNMENT_KEY.lastIndex);
      values.push(parsed);
      AUTH_ASSIGNMENT_KEY.lastIndex = Math.max(AUTH_ASSIGNMENT_KEY.lastIndex + 1, parsed.end);
    }
  }
  return values;
}

function logicalLines(text) {
  return stringValue(text).split(/\r?\n/u);
}

function parseAssignmentValueAt(line, start, maxChars) {
  let index = start;
  while (index < line.length && /\s/u.test(line[index])) index += 1;
  if (line[index] === "\"" || line[index] === "'") {
    return parseQuotedValueAt(line, index, maxChars);
  }
  const raw = line.slice(index).trim();
  return {
    value: raw.slice(0, maxChars),
    end: line.length,
    tooLong: Array.from(raw).length > maxChars,
    malformed: false
  };
}

function parseQuotedValueAt(line, start, maxChars) {
  const quote = line[start];
  let escaped = false;
  let value = "";
  for (let index = start + 1; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      value += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return {
        value: value.slice(0, maxChars),
        end: index + 1,
        tooLong: Array.from(value).length > maxChars,
        malformed: false
      };
    } else {
      value += char;
    }
    if (Array.from(value).length > maxChars) {
      return {
        value: value.slice(0, maxChars),
        end: index + 1,
        tooLong: true,
        malformed: false
      };
    }
  }
  return {
    value: value.slice(0, maxChars),
    end: line.length,
    tooLong: Array.from(value).length > maxChars,
    malformed: true
  };
}

function parseAuthorizationLogicalValueAt(line, start) {
  let index = start;
  while (index < line.length && /\s/u.test(line[index])) index += 1;
  let quote = "";
  let escaped = false;
  let value = "";
  let tooLong = false;
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      value += char;
      escaped = false;
    } else if (quote && char === "\\") {
      escaped = true;
      continue;
    } else {
      value += char;
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === "\"" || char === "'") {
        quote = char;
      }
    }
    if (Array.from(value).length > MAX_AUTHORIZATION_VALUE_CHARS) {
      tooLong = true;
      break;
    }
  }
  const parameterStats = inspectAuthorizationParameters(value);
  return {
    value: value.slice(0, MAX_AUTHORIZATION_VALUE_CHARS),
    end: tooLong ? index + 1 : line.length,
    tooLong: tooLong || parameterStats.valueTooLong,
    malformed: Boolean(quote) || escaped,
    tooManyParameters: parameterStats.count > MAX_AUTHORIZATION_PARAMETERS
  };
}

function inspectAuthorizationParameters(value) {
  let quote = "";
  let escaped = false;
  let token = "";
  let count = 0;
  let valueTooLong = false;
  const flush = () => {
    const text = token.trim();
    token = "";
    const match = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s*=\s*(.*)$/u.exec(text);
    if (!match) return;
    count += 1;
    const paramValue = stripOuterQuotes(match[2].trim());
    if (Array.from(paramValue).length > MAX_AUTHORIZATION_PARAMETER_VALUE_CHARS) {
      valueTooLong = true;
    }
  };
  for (const char of stringValue(value)) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      token += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      token += char;
      quote = char;
      continue;
    }
    if (char === "," || char === ";") {
      flush();
      continue;
    }
    token += char;
  }
  flush();
  return { count, valueTooLong };
}

function containsCookieAssignmentCredential(key, value) {
  const canonical = canonicalCookieName(key);
  if (canonical === "cookie" || canonical === "setcookie") {
    const pairs = parseCookiePairs(value, canonical === "setcookie");
    for (const pair of pairs) {
      if (isHighConfidenceCookieCredential(pair.name, pair.value, { assignment: true })) return true;
    }
    if (pairs.length > 0) return false;
  }
  return isHighConfidenceCookieCredential(key, value, { assignment: true });
}

function parseCookiePairs(headerValue, setCookie) {
  const segments = splitCookieSegments(headerValue);
  const pairs = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (setCookie && index > 0 && isSetCookieAttribute(segments[index])) continue;
    const separator = segments[index].indexOf("=");
    if (separator <= 0) continue;
    const name = segments[index].slice(0, separator).trim();
    const value = stripOuterQuotes(unescapeCookieValue(trimCookiePairValue(segments[index].slice(separator + 1).trim())));
    if (!name || !value) continue;
    pairs.push({ name, value });
    if (setCookie) break;
  }
  return pairs;
}

function boundedHeaderValue(value) {
  return stringValue(value).split(/\\r|\\n|",(?=[A-Za-z_"])/u)[0].trim();
}

function splitCookieSegments(value) {
  const segments = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of stringValue(value)) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === ";") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function isSetCookieAttribute(segment) {
  const name = stringValue(segment).split("=", 1)[0].trim().toLowerCase();
  return new Set([
    "domain",
    "expires",
    "httponly",
    "max-age",
    "partitioned",
    "path",
    "priority",
    "samesite",
    "secure"
  ]).has(name);
}

function isHighConfidenceCookieCredential(name, value, options = {}) {
  const cleanValue = stripOuterQuotes(value).trim();
  if (!cleanValue || isPlaceholderCredential(cleanValue)) return false;
  if (containsBase64DataUri(cleanValue)) return true;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, cleanValue)) return true;
  if (containsVerifiableLongBase64(cleanValue)) return true;
  if (/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}$/u.test(cleanValue)) return true;
  if (/\s/u.test(cleanValue)) return containsLikelyCookieCredentialToken(cleanValue);

  const tokenLike = /^[A-Za-z0-9._~+/=-]+$/u.test(cleanValue);
  const canonicalName = canonicalCookieName(name);
  if (isStrictCredentialCookieName(canonicalName)) return true;
  const highRiskName = isHighRiskCookieName(canonicalName);
  if (highRiskName) {
    if (/^(?:secret|token|auth|session|credential|password|jwt)$/iu.test(cleanValue)) return true;
    if (isLikelyCredentialValue(cleanValue)) return true;
    if (tokenLike && cleanValue.length >= 16 && /[A-Za-z0-9]/u.test(cleanValue)) return true;
    return tokenLike && cleanValue.length >= 8 && shannonEntropy(cleanValue) >= 3.0;
  }

  if (/^(?:sid|sess|session|tok|token|jwt|auth)[_-]?[A-Za-z0-9._~+/=-]{12,}$/iu.test(cleanValue)) return true;
  return tokenLike
    && cleanValue.length >= 32
    && /[A-Za-z]/u.test(cleanValue)
    && /\d/u.test(cleanValue)
    && shannonEntropy(cleanValue) >= 3.2;
}

function containsLikelyCookieCredentialToken(value) {
  return stringValue(value)
    .split(/[\s,;"'，；。、“”‘’()（）<>《》]+/u)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9._~+/=-]+$/u.test(part))
    .some((part) => {
      if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, part)) return true;
      if (isPlaceholderCredential(part)) return false;
      if (/^(?:sid|sess|session|tok|token|jwt|auth)[_-]?[A-Za-z0-9._~+/=-]{12,}$/iu.test(part)) return true;
      return part.length >= 24 && /[A-Za-z]/u.test(part) && /\d/u.test(part) && shannonEntropy(part) >= 3.2;
    });
}

function isHighRiskCookieName(name) {
  return new Set([
    "session",
    "sessionid",
    "sid",
    "auth",
    "authtoken",
    "token",
    "accesstoken",
    "refreshtoken",
    "jwt",
    "csrf",
    "xsrf",
    "rememberme",
    "credential",
    "apikey"
  ]).has(canonicalCookieName(name));
}

function isStrictCredentialCookieName(canonicalName) {
  return new Set([
    "sessionid",
    "sid",
    "auth",
    "authtoken",
    "token",
    "accesstoken",
    "refreshtoken",
    "jwt",
    "credential",
    "apikey"
  ]).has(canonicalName);
}

function canonicalCookieName(name) {
  return normalizeTextForSensitiveScan(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function unescapeCookieValue(value) {
  return stringValue(value).replace(/\\(["'\\])/g, "$1");
}

function trimCookiePairValue(value) {
  const text = stringValue(value).trim();
  if (!text || text.startsWith("\"") || text.startsWith("'")) return text;
  const terminator = text.search(/[\s"'“”‘’。；，、<>《》]/u);
  return terminator < 0 ? text : text.slice(0, terminator);
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
