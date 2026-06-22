const CREDENTIAL_ASSIGNMENT = /\b(proxy[_-]?authorization|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password)\b\s*[:=]\s*(?:"([^"\r\n]{8,})"|'([^'\r\n]{8,})'|([^\s,;]{8,}))/giu;
const BARE_BEARER = /\bbearer\s+([A-Za-z0-9._~+/\-=]{20,})\b/giu;
const BARE_BASIC = /\bbasic\s+([A-Za-z0-9+/=]{16,})\b/giu;
const KNOWN_CREDENTIAL_VALUE = /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})(?=$|[^A-Za-z0-9])/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const BASE64_DATA_URI = /\bdata:[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9._+-]+=[^,;\s]+|;[a-z0-9._+-]+)*;base64,[A-Za-z0-9+/=\s]*/gi;
const LONG_BASE64_CANDIDATE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{80,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const PLACEHOLDER_PREFIX_CREDENTIAL_TOKEN = /(?:^|[^A-Za-z0-9_-])((?:your|test|fake|sample|synthetic|demo)_(?:bearer|token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password)(?:_[A-Za-z0-9][A-Za-z0-9._-]{7,}|[A-Za-z0-9][A-Za-z0-9._-]{7,})|[A-Za-z0-9][A-Za-z0-9._-]{1,64}_(?:your_(?:bearer|token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password)(?:_placeholder)?|(?:bearer|token|api[_-]?key|key|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password)_placeholder))/giu;
const AUTH_SCHEME = /^[A-Za-z][A-Za-z0-9._+-]{0,63}$/u;
const AUTH_PARAM_CREDENTIAL = /\b(?:response|signature|credential|token|key|secret|password|access_token|client_secret)\s*=\s*"?([^",\s]{8,})"?/giu;
const SENSITIVE_AUTHORIZATION_PARAMETER_NAMES = new Set([
  "response",
  "signature",
  "credential",
  "token",
  "key",
  "secret",
  "password",
  "access_token",
  "client_secret",
  "auth_token",
  "refresh_token",
  "api_key",
  "apikey"
]);
const TEACHING_CONTEXT = /教学|示例|占位|占位符|说明|语法|格式|流程|文案|产品|包装|不是|非真实|not\s+real|placeholder|example|sample|dummy/iu;
const DEFAULT_IGNORABLE_AND_FORMAT_CONTROLS = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const FULLWIDTH_PUNCTUATION = /[：﹕꞉︓]/gu;
const FULLWIDTH_EQUALS = /[＝﹦]/gu;
const MAX_SENSITIVE_SCAN_TOTAL_CHARS = 64 * 1024;
const MAX_SENSITIVE_SCAN_LINE_CHARS = 16 * 1024;
const MAX_AUTHORIZATION_VALUE_CHARS = 4096;
const MAX_AUTHORIZATION_PARAMETERS = 32;
const MAX_AUTHORIZATION_PARAMETER_VALUE_CHARS = 2048;
const MAX_COOKIE_VALUE_CHARS = 4096;
const MAX_SENSITIVE_MARKER_SEGMENTS = 512;
const MARKER_DEFINITIONS = Object.freeze([
  { marker: "proxy-authorization", type: "proxy_authorization" },
  { marker: "proxy_authorization", type: "proxy_authorization" },
  { marker: "authorization", type: "authorization" },
  { marker: "set-cookie", type: "set_cookie" },
  { marker: "set_cookie", type: "set_cookie" },
  { marker: "cookie", type: "cookie" }
]);

export function containsHighConfidenceSensitivePayload(value) {
  const original = stringValue(value);
  if (original.length > MAX_SENSITIVE_SCAN_TOTAL_CHARS) return true;
  const normalized = normalizeTextForSensitiveScan(original);
  const candidates = Array.from(new Set([
    original,
    normalized,
    unescapeScanQuotes(original),
    unescapeScanQuotes(normalized)
  ]));
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
  const markerScan = scanSensitivePayloadMarkers(text);
  if (markerScan.tooLong) return true;
  if (PRIVATE_KEY_BLOCK.test(text)) return true;
  if (markerScan.unclosedQuote && containsSensitiveMaskedMarkerPayload(markerScan.maskedSegments)) return true;
  if (containsAuthorizationMarkerSegments(markerScan.segments)) return true;
  if (containsBareAuthCredential(BARE_BEARER, text)) return true;
  if (containsBareAuthCredential(BARE_BASIC, text)) return true;
  if (containsCookieMarkerSegments(markerScan.segments)) return true;
  if (containsQuotedMarkerPayload(markerScan.quotedValues)) return true;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, text)) return true;
  if (containsPlaceholderPrefixCredentialToken(text)) return true;
  if (containsCredentialAssignment(text)) return true;
  if (containsBase64DataUri(text)) return true;
  return containsVerifiableLongBase64(text);
}

export function scanSensitivePayloadMarkersForTest(value) {
  const scan = scanSensitivePayloadMarkers(normalizeTextForSensitiveScan(value));
  return {
    tooLong: scan.tooLong,
    unclosedQuote: scan.unclosedQuote,
    maskedMarker: scan.maskedMarker,
    segments: scan.segments.map(({ type, separator, start, valueStart, valueEnd, malformed, tooLong }) => ({
      type,
      separator,
      start,
      valueStart,
      valueEnd,
      malformed,
      tooLong
    }))
  };
}

function containsQuotedMarkerPayload(quotedValues) {
  for (const value of quotedValues || []) {
    const scan = scanSensitivePayloadMarkers(unescapeScanQuotes(value), { collectQuotedValues: false });
    if (scan.tooLong) return true;
    if (scan.unclosedQuote && containsSensitiveMaskedMarkerPayload(scan.maskedSegments)) return true;
    if (containsAuthorizationMarkerSegments(scan.segments)) return true;
    if (containsCookieMarkerSegments(scan.segments)) return true;
  }
  return false;
}

function containsSensitiveMaskedMarkerPayload(segments) {
  return containsAuthorizationMarkerSegments(segments) || containsCookieMarkerSegments(segments);
}

function containsAuthorizationMarkerSegments(segments) {
  for (const item of segments) {
    if (item.type !== "authorization" && item.type !== "proxy_authorization") continue;
    if (item.tooLong) return true;
    if (item.malformed && !item.masked) return true;
    if (item.tooManyParameters) return true;
    const value = stringValue(item.value).trim();
    if (!value || isPlaceholderCredential(value)) continue;
    if (containsAssignedAuthorizationCredential(value)) return true;
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

function containsAuthorizationParameterCredential(value) {
  return parseAuthorizationParameters(value).some((item) => {
    if (!item.value) return false;
    if (item.valueTooLong) return true;
    if (isPlaceholderCredential(item.value)) return false;
    return isSensitiveAuthorizationParameterName(item.name)
      ? isLikelyCredentialValue(item.value) || isCredentialAssignmentValue(item.value)
      : isUnknownAuthorizationParameterCredentialValue(item.value);
  });
}

function containsPlaceholderPrefixCredentialToken(text) {
  PLACEHOLDER_PREFIX_CREDENTIAL_TOKEN.lastIndex = 0;
  let match;
  while ((match = PLACEHOLDER_PREFIX_CREDENTIAL_TOKEN.exec(text))) {
    const token = match[1] || "";
    if (!isPlaceholderCredential(token) && isLikelyCredentialValue(token)) return true;
  }
  return false;
}

function containsCookieMarkerSegments(segments) {
  for (const item of segments) {
    if (item.type !== "cookie" && item.type !== "set_cookie") continue;
    if (item.tooLong || (item.malformed && !item.masked)) return true;
    if (containsCookieAssignmentCredential(item.type === "set_cookie" ? "set-cookie" : "cookie", item.value)) {
      return true;
    }
  }
  return false;
}

function containsCredentialAssignment(text) {
  CREDENTIAL_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = CREDENTIAL_ASSIGNMENT.exec(text))) {
    const key = match[1];
    if (isAuthorizationAssignmentKey(key) && isInsideOpenQuoteAt(text, match.index)) continue;
    const value = unescapeScanQuotes(stringValue(match[2] || match[3] || match[4])).trim();
    if (!value || isPlaceholderCredential(value)) continue;
    if (isAuthorizationAssignmentKey(key)) {
      if (containsAssignedAuthorizationCredential(trimNarrativeMarkerValue(value))) return true;
      continue;
    }
    if (isLikelyCredentialValue(value)) return true;
    if (isCredentialAssignmentValue(value)) return true;
  }
  return false;
}

function isInsideOpenQuoteAt(text, position) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < position; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
  }
  return Boolean(quote) || escaped;
}

function scanSensitivePayloadMarkers(text, options = {}) {
  const source = stringValue(text);
  if (source.length > MAX_SENSITIVE_SCAN_TOTAL_CHARS) {
    return { segments: [], quotedValues: [], maskedSegments: [], tooLong: true, unclosedQuote: false, maskedMarker: false };
  }
  const segments = [];
  const quotedValues = [];
  const maskedSegments = [];
  let unclosedQuote = false;
  let maskedMarker = false;
  let markerCount = 0;
  let offset = 0;
  const parts = source.split(/(\r?\n)/u);
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] || "";
    if (line.length > MAX_SENSITIVE_SCAN_LINE_CHARS) {
      return { segments, quotedValues, tooLong: true, unclosedQuote, maskedMarker };
    }
    const lineScan = scanTopLevelMarkersInLine(line, offset, options);
    const markers = lineScan.markers;
    markerCount += markers.length + lineScan.maskedMarkers.length;
    if (markerCount > MAX_SENSITIVE_MARKER_SEGMENTS) {
      return { segments, quotedValues, maskedSegments, tooLong: true, unclosedQuote, maskedMarker };
    }
    if (lineScan.unclosedQuote) unclosedQuote = true;
    if (lineScan.maskedMarker) maskedMarker = true;
    if (options.collectQuotedValues !== false) quotedValues.push(...lineScan.quotedValues);
    if (lineScan.unclosedQuote && lineScan.maskedMarkers.length > 0) {
      const masked = buildMarkerSegments(source, lineScan.maskedMarkers, offset + line.length);
      maskedSegments.push(...masked);
    }
    segments.push(...buildMarkerSegments(source, markers, offset + line.length));
    offset += line.length + (parts[index + 1] || "").length;
  }
  return { segments, quotedValues, maskedSegments, tooLong: false, unclosedQuote, maskedMarker };
}

function buildMarkerSegments(source, markers, lineEnd) {
  const segments = [];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
    const marker = markers[markerIndex];
    const nextMarker = markers[markerIndex + 1];
    const valueEnd = nextMarker ? nextMarker.start : lineEnd;
    const rawValue = source.slice(marker.valueStart, valueEnd);
    const boundedRawValue = trimNarrativeMarkerValue(rawValue);
    const value = unescapeScanQuotes(marker.quotedKey ? trimJsonLikeMarkerValue(boundedRawValue) : boundedRawValue).trim();
    const stats = inspectMarkerValue(value, marker.type);
    const segment = {
      type: marker.type,
      separator: marker.separator,
      start: marker.start,
      valueStart: marker.valueStart,
      valueEnd,
      value: value.slice(0, marker.type === "authorization" || marker.type === "proxy_authorization"
        ? MAX_AUTHORIZATION_VALUE_CHARS
        : MAX_COOKIE_VALUE_CHARS),
      tooLong: stats.tooLong,
      malformed: stats.malformed,
      masked: marker.masked === true
    };
    if (marker.type === "authorization" || marker.type === "proxy_authorization") {
      const parameterStats = inspectAuthorizationParameters(value);
      segment.tooLong = segment.tooLong || parameterStats.valueTooLong;
      segment.tooManyParameters = parameterStats.count > MAX_AUTHORIZATION_PARAMETERS;
    }
    segments.push(segment);
  }
  return segments;
}

function trimNarrativeMarkerValue(value) {
  const text = stringValue(value);
  const terminator = text.search(/[“”‘’。]/u);
  return terminator < 0 ? text : text.slice(0, terminator);
}

function scanTopLevelMarkersInLine(line, offset, options = {}) {
  const markers = [];
  const maskedMarkers = [];
  const quotedValues = [];
  let quote = "";
  let quoteStart = -1;
  let quoteValue = "";
  let escaped = false;
  let maskedMarker = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      if (quote) quoteValue += char;
      escaped = false;
      continue;
    }
    if (quote) {
      const nestedQuotedMarker = readQuotedMarkerKeyAt(line, index);
      if (nestedQuotedMarker) {
        maskedMarker = true;
        maskedMarkers.push({
          ...nestedQuotedMarker,
          start: offset + index,
          valueStart: offset + nestedQuotedMarker.valueStart,
          masked: true
        });
        const valueQuoteStart = readQuoteStartAt(line, nestedQuotedMarker.valueStart);
        const skipEnd = valueQuoteStart ? valueQuoteStart.cursor : nestedQuotedMarker.valueStart;
        quoteValue += line.slice(index, skipEnd);
        index = skipEnd - 1;
        continue;
      }
      const nestedMarker = readSensitiveMarkerAt(line, index);
      if (nestedMarker) {
        maskedMarker = true;
        maskedMarkers.push({
          ...nestedMarker,
          start: offset + index,
          valueStart: offset + nestedMarker.valueStart,
          masked: true
        });
      }
      if (char === "\\") {
        quoteValue += char;
        escaped = true;
      } else if (char === quote) {
        if (options.collectQuotedValues !== false) {
          quotedValues.push(quoteValue);
        }
        quote = "";
        quoteStart = -1;
        quoteValue = "";
      } else {
        quoteValue += char;
      }
      continue;
    }
    if (char === "\"" || char === "'" || (char === "\\" && (line[index + 1] === "\"" || line[index + 1] === "'"))) {
      const quotedMarker = readQuotedMarkerKeyAt(line, index);
      if (quotedMarker) {
        markers.push({
          ...quotedMarker,
          start: offset + index,
          valueStart: offset + quotedMarker.valueStart
        });
        index = quotedMarker.valueStart - 1;
        continue;
      }
      if (char === "\\") continue;
      quote = char;
      quoteStart = index;
      quoteValue = "";
      continue;
    }
    const marker = readSensitiveMarkerAt(line, index);
    if (!marker) continue;
    markers.push({
      ...marker,
      start: offset + index,
      valueStart: offset + marker.valueStart
    });
  }
  return {
    markers,
    maskedMarkers,
    quotedValues,
    unclosedQuote: Boolean(quote) || escaped,
    maskedMarker: maskedMarker && (Boolean(quote) || escaped),
    quoteStart: quoteStart >= 0 ? offset + quoteStart : -1
  };
}

function readSensitiveMarkerAt(line, index) {
  if (!hasMarkerBoundaryBefore(line, index)) return null;
  for (const definition of MARKER_DEFINITIONS) {
    if (!matchesAsciiMarkerAt(line, index, definition.marker)) continue;
    let cursor = index + definition.marker.length;
    if (isMarkerIdentifierChar(line[cursor])) continue;
    while (cursor < line.length && /[ \t]/u.test(line[cursor])) cursor += 1;
    const separator = line[cursor];
    if (separator !== ":" && separator !== "=") continue;
    cursor += 1;
    while (cursor < line.length && /[ \t]/u.test(line[cursor])) cursor += 1;
    return {
      type: definition.type,
      separator,
      valueStart: cursor
    };
  }
  return null;
}

function readQuotedMarkerKeyAt(line, index) {
  const quoteStart = readQuoteStartAt(line, index);
  if (!quoteStart) return null;
  const { quote, cursor: keyStart, escapedQuote } = quoteStart;
  let escaped = false;
  let end = -1;
  for (let cursor = keyStart; cursor < line.length; cursor += 1) {
    const char = line[cursor];
    if (escapedQuote && char === "\\" && line[cursor + 1] === quote) {
      end = cursor;
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      end = cursor;
      break;
    }
  }
  if (end < 0) return null;
  const key = line.slice(keyStart, end);
  const definition = findMarkerDefinitionByKey(key);
  if (!definition) return null;
  let cursor = escapedQuote ? end + 2 : end + 1;
  while (cursor < line.length && /[ \t]/u.test(line[cursor])) cursor += 1;
  const separator = line[cursor];
  if (separator !== ":" && separator !== "=") return null;
  cursor += 1;
  while (cursor < line.length && /[ \t]/u.test(line[cursor])) cursor += 1;
  return {
    type: definition.type,
    separator,
    valueStart: cursor,
    quotedKey: true
  };
}

function readQuoteStartAt(line, index) {
  if (line[index] === "\"" || line[index] === "'") {
    return { quote: line[index], cursor: index + 1, escapedQuote: false };
  }
  if (line[index] === "\\" && (line[index + 1] === "\"" || line[index + 1] === "'")) {
    return { quote: line[index + 1], cursor: index + 2, escapedQuote: true };
  }
  return null;
}

function trimJsonLikeMarkerValue(value) {
  const text = stringValue(value);
  let start = 0;
  while (start < text.length && /[ \t]/u.test(text[start])) start += 1;
  const quoteStart = readQuoteStartAt(text, start);
  if (quoteStart) {
    const { quote, cursor: valueStart, escapedQuote } = quoteStart;
    let escaped = false;
    for (let cursor = valueStart; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (escapedQuote && char === "\\" && text[cursor + 1] === quote) {
        return text.slice(start, cursor + 2);
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (!escapedQuote && char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) return text.slice(start, cursor + 1);
    }
    return text.slice(start);
  }
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if (text[cursor] === "," || text[cursor] === "}" || text[cursor] === "]" || /[“”‘’。]/u.test(text[cursor])) {
      return text.slice(start, cursor);
    }
  }
  return text.slice(start);
}

function findMarkerDefinitionByKey(key) {
  return MARKER_DEFINITIONS.find((item) => item.marker.length === key.length && matchesAsciiMarkerAt(key, 0, item.marker));
}

function matchesAsciiMarkerAt(text, index, marker) {
  if (index < 0 || index + marker.length > text.length) return false;
  for (let offset = 0; offset < marker.length; offset += 1) {
    const code = text.charCodeAt(index + offset);
    let actual = code;
    if (actual >= 65 && actual <= 90) actual += 32;
    if (actual !== marker.charCodeAt(offset)) return false;
  }
  return true;
}

function hasMarkerBoundaryBefore(line, index) {
  return index === 0 || !isMarkerIdentifierChar(line[index - 1]);
}

function isMarkerIdentifierChar(char) {
  return typeof char === "string" && /[A-Za-z0-9_-]/u.test(char);
}

function inspectMarkerValue(value, type) {
  const maxChars = type === "authorization" || type === "proxy_authorization"
    ? MAX_AUTHORIZATION_VALUE_CHARS
    : MAX_COOKIE_VALUE_CHARS;
  let quote = "";
  let escaped = false;
  let length = 0;
  for (const char of stringValue(value)) {
    length += 1;
    if (length > maxChars) return { tooLong: true, malformed: false };
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
  }
  return { tooLong: false, malformed: Boolean(quote) || escaped };
}

function isAuthorizationAssignmentKey(key) {
  const canonical = stringValue(key).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return canonical === "authorization" || canonical === "proxyauthorization";
}

function containsAssignedAuthorizationCredential(value) {
  const compact = stringValue(value).trim();
  if (!compact) return false;
  const segment = unescapeScanQuotes(compact);
  const quotedText = stripOuterQuotes(segment).trim();
  if (quotedText !== segment.trim()
    && TEACHING_CONTEXT.test(quotedText)
    && !testGlobalPattern(KNOWN_CREDENTIAL_VALUE, quotedText)
    && !containsCredentialParameter(quotedText)
    && !containsLikelyCredentialToken(quotedText)) {
    return false;
  }
  if (TEACHING_CONTEXT.test(segment)
    && !testGlobalPattern(KNOWN_CREDENTIAL_VALUE, segment)
    && !containsCredentialParameter(segment)
    && !containsAuthorizationParameterCredential(segment)
    && !containsLikelyCredentialToken(segment)) {
    return false;
  }
  if (containsCredentialParameter(segment)) return true;
  if (containsAuthorizationParameterCredential(segment)) return true;
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
  return isAuthorizationSchemeCredentialValue(credential);
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

function isAuthorizationSchemeCredentialValue(value) {
  const compact = stripOuterQuotes(value).trim();
  if (!compact || isPlaceholderCredential(compact)) return false;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, compact)) return true;
  if (compact.length >= 16 && /[A-Za-z0-9]/u.test(compact) && /[!@#$%^&*():]/u.test(compact)) return true;
  if (containsLikelyCredentialToken(compact)) return true;
  if (/^(?:marker|synthetic|session|auth|access|refresh|credential|secret|token|jwt|key|api)[A-Za-z0-9._~+/-]{12,}$/iu.test(compact)) {
    return true;
  }
  if (/^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}$/u.test(compact)) return true;
  return compact.length >= 24 && /[A-Za-z]/u.test(compact) && /\d/u.test(compact) && shannonEntropy(compact) >= 3.2;
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

function inspectAuthorizationParameters(value) {
  const parameters = parseAuthorizationParameters(value);
  return {
    count: parameters.length,
    valueTooLong: parameters.some((item) => item.valueTooLong)
  };
}

function parseAuthorizationParameters(value) {
  let quote = "";
  let escaped = false;
  let token = "";
  const parameters = [];
  const flush = () => {
    const text = token.trim();
    token = "";
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64})\s*=\s*(.*)$/u.exec(text);
    if (!match) return;
    const paramValue = trimAuthorizationParameterValue(match[2]);
    parameters.push({
      name: match[1],
      value: paramValue,
      valueTooLong: Array.from(paramValue).length > MAX_AUTHORIZATION_PARAMETER_VALUE_CHARS
    });
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
  return parameters;
}

function trimAuthorizationParameterValue(value) {
  const text = stringValue(value).trim();
  if (!text) return "";
  const quoteStart = readQuoteStartAt(text, 0);
  if (quoteStart) {
    const { quote, cursor: valueStart, escapedQuote } = quoteStart;
    let escaped = false;
    let out = "";
    for (let cursor = valueStart; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (escapedQuote && char === "\\" && text[cursor + 1] === quote) return out;
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (!escapedQuote && char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) return out;
      out += char;
    }
    return out;
  }
  const terminator = text.search(/[\s"'“”‘’。；，、<>《》]/u);
  return terminator < 0 ? text : text.slice(0, terminator);
}

function isSensitiveAuthorizationParameterName(name) {
  return SENSITIVE_AUTHORIZATION_PARAMETER_NAMES.has(canonicalAuthorizationParameterName(name));
}

function canonicalAuthorizationParameterName(name) {
  return normalizeTextForSensitiveScan(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function isUnknownAuthorizationParameterCredentialValue(value) {
  const compact = stripOuterQuotes(value).trim();
  if (!compact || isPlaceholderCredential(compact)) return false;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, compact)) return true;
  if (/^(?:bearer|basic|digest|apikey|token|custom|aws4-hmac-sha256)\s+/iu.test(compact)) {
    return containsLikelyCredentialToken(compact);
  }
  if (/^(?:marker|synthetic|session|auth|access|refresh|credential|secret|token|jwt)[A-Za-z0-9._~+/-]{12,}$/iu.test(compact)) {
    return true;
  }
  if (/^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}$/u.test(compact)) return true;
  return compact.length >= 24 && /[A-Za-z]/u.test(compact) && /\d/u.test(compact) && shannonEntropy(compact) >= 3.2;
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
  return isHighConfidenceCookieCredential(key, trimCookiePairValue(value), { assignment: true });
}

function parseCookiePairs(headerValue, setCookie) {
  const segments = splitCookieSegments(stripOuterQuotes(headerValue));
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
  if (!cleanValue) return false;
  const candidates = decodedCredentialCandidates(cleanValue);
  if (candidates.some((candidate) => containsEncodedCredentialPayload(candidate))) return true;
  if (isPlaceholderCredential(cleanValue)) return false;
  if (candidates.some((candidate) => /\s/u.test(candidate) && containsLikelyCookieCredentialToken(candidate))) return true;

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

function containsEncodedCredentialPayload(value) {
  return containsBase64DataUri(value)
    || testGlobalPattern(KNOWN_CREDENTIAL_VALUE, value)
    || containsVerifiableLongBase64(value)
    || /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}$/u.test(value);
}

function decodedCredentialCandidates(value) {
  const text = stringValue(value);
  const candidates = [text];
  if (text.length <= MAX_COOKIE_VALUE_CHARS && /%[0-9A-Fa-f]{2}/u.test(text)) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded !== text) candidates.push(decoded);
    } catch {
      const dotDecoded = text.replace(/%2e/giu, ".").replace(/%2d/giu, "-").replace(/%5f/giu, "_");
      if (dotDecoded !== text) candidates.push(dotDecoded);
    }
  }
  return Array.from(new Set(candidates));
}

function containsLikelyCookieCredentialToken(value) {
  return stringValue(value)
    .split(/[\s,;"'，；。、“”‘’()（）<>《》]+/u)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z0-9._~+/=-]+$/u.test(part))
    .some((part) => {
      if (isCredentialStructuralWord(part)) return false;
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
    "csrftoken",
    "xsrf",
    "xsrftoken",
    "rememberme",
    "credential",
    "apikey"
  ]).has(canonicalCookieName(name));
}

function isStrictCredentialCookieName(canonicalName) {
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
    "csrftoken",
    "xsrf",
    "xsrftoken",
    "rememberme",
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
  if (!compact) return false;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, compact)) return true;
  if (isPlaceholderCredential(compact)) return false;
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
    if (isCredentialStructuralWord(part)) return false;
    if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, part)) return true;
    if (isPlaceholderCredential(part)) return false;
    if (part.length >= 20 && /[A-Za-z0-9]/u.test(part)) return true;
    return part.length >= 12 && /[A-Za-z0-9]/u.test(part) && shannonEntropy(part) >= 3.2;
  });
}

function isCredentialStructuralWord(value) {
  return new Set([
    "apikey",
    "authorization",
    "basic",
    "bearer",
    "cookie",
    "custom",
    "digest",
    "proxyauthorization",
    "setcookie",
    "token",
    "aws4hmacsha256"
  ]).has(stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function isPlaceholderCredential(value) {
  const compact = normalizeTextForSensitiveScan(stripOuterQuotes(value))
    .trim()
    .replace(/\s+/gu, "");
  if (!compact) return false;
  if (testGlobalPattern(KNOWN_CREDENTIAL_VALUE, compact)) return false;
  const credentialName = "(?:TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|BEARER_TOKEN|API_KEY|KEY|CLIENT_SECRET|SECRET|PASSWORD|SESSION_COOKIE|COOKIE|SESSION|VALUE)";
  const wrappedPlaceholder = new RegExp(`^(?:<${credentialName}>|\\$\\{${credentialName}\\}|\\{${credentialName}\\})$`, "iu");
  if (wrappedPlaceholder.test(compact)) return true;
  const normalized = compact
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (!normalized) return false;
  const credentialPattern = "(?:TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|BEARER_TOKEN|API_KEY|KEY|CLIENT_SECRET|SECRET|PASSWORD|SESSION_COOKIE|COOKIE|SESSION|VALUE)";
  const placeholderPrefix = "(?:TEST|FAKE|SAMPLE|SYNTHETIC|DEMO)";
  return normalized === "REPLACE_ME"
    || normalized === "VALUE"
    || new RegExp(`^YOUR_${credentialPattern}(?:_PLACEHOLDER)?$`, "u").test(normalized)
    || new RegExp(`^${credentialPattern}_PLACEHOLDER$`, "u").test(normalized)
    || new RegExp(`^INSERT_${credentialPattern}_HERE$`, "u").test(normalized)
    || new RegExp(`^${placeholderPrefix}_${credentialPattern}$`, "u").test(normalized);
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
