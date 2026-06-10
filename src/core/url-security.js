import { isIP } from "node:net";
import { ImageApiError } from "./errors.js";

export function normalizePublicHttpUrl(value, field, {
  allowLocal = false,
  statusCode = 400,
  errorCode = "INVALID_REQUEST_SCHEMA"
} = {}) {
  const raw = stringValue(value).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throwUrlError(field, "必须是合法 URL。", statusCode, errorCode);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throwUrlError(field, "必须是 http 或 https URL。", statusCode, errorCode);
  }
  if (!allowLocal && isUnsafeNetworkHost(parsed.hostname)) {
    throwUrlError(field, "默认不允许 localhost、loopback、link-local 或内网地址。", statusCode, errorCode);
  }
  return raw;
}

export function normalizePublicBaseUrl(value, {
  allowLocal = process.env.NODE_ENV !== "production",
  statusCode = 500,
  errorCode = "PUBLIC_BASE_URL_INVALID"
} = {}) {
  const normalized = normalizePublicHttpUrl(value, "PUBLIC_BASE_URL", {
    allowLocal,
    statusCode,
    errorCode
  });
  return normalized.replace(/\/+$/, "");
}

export function isUnsafeNetworkHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.localdomain") return true;
  if (host === "0.0.0.0") return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4(host);
  if (ipVersion === 6) return isUnsafeIpv6(host);

  const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4[1]);

  return false;
}

function normalizeHost(hostname) {
  return stringValue(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "")
    .replace(/\.+$/, "");
}

function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function isUnsafeIpv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isUnsafeIpv6(host) {
  if (host === "::" || host === "::1") return true;
  const mappedIpv4 = ipv4FromEmbeddedIpv6(host);
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);

  const first = host.split(":").find(Boolean);
  const firstHextet = Number.parseInt(first || "0", 16);
  if (!Number.isFinite(firstHextet)) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  return false;
}

function ipv4FromEmbeddedIpv6(host) {
  const hextets = expandIpv6Hextets(host);
  if (!hextets) return "";
  const firstFiveZero = hextets.slice(0, 5).every((part) => part === 0);
  const isMapped = firstFiveZero && hextets[5] === 0xffff;
  const isCompatible = firstFiveZero && hextets[5] === 0;
  if (!isMapped && !isCompatible) return "";
  const value = ((hextets[6] << 16) | hextets[7]) >>> 0;
  if (!value) return "";
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join(".");
}

function expandIpv6Hextets(host) {
  const value = stringValue(host).trim().toLowerCase();
  if (!value || value.includes(":::")) return null;
  const dotted = value.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
  let source = value;
  if (dotted) {
    const parts = dotted[2].split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${dotted[1]}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const hasCompress = source.includes("::");
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = hasCompress ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;
  const parts = hasCompress ? [...left, ...Array(missing).fill("0"), ...right] : source.split(":");
  if (parts.length !== 8) return null;
  const hextets = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return Number.NaN;
    return Number.parseInt(part, 16);
  });
  return hextets.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff) ? null : hextets;
}

function throwUrlError(field, message, statusCode, errorCode) {
  throw new ImageApiError({
    statusCode,
    status: "failed",
    errorCode,
    message: `${field} ${message}`
  });
}
