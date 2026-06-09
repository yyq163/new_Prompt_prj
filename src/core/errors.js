export class ImageApiError extends Error {
  constructor({ statusCode = 400, status = "failed", errorCode = "INVALID_REQUEST_SCHEMA", message = "请求无效。", details = null } = {}) {
    super(message);
    this.name = "ImageApiError";
    this.statusCode = statusCode;
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export function fail(errorCode, message, statusCode = 400, details = null) {
  throw new ImageApiError({ statusCode, status: "failed", errorCode, message, details });
}

export function clarification(errorCode, message, statusCode = 200, details = null) {
  throw new ImageApiError({ statusCode, status: "needs_clarification", errorCode, message, details });
}

export function providerConfigMissing() {
  throw new ImageApiError({
    statusCode: 503,
    status: "failed",
    errorCode: "PROVIDER_CONFIG_MISSING",
    message: "图片生成 provider 配置缺失，请先配置真实上游服务。"
  });
}

export function providerUnsupported() {
  throw new ImageApiError({
    statusCode: 502,
    status: "failed",
    errorCode: "PROVIDER_RESPONSE_UNSUPPORTED",
    message: "上游返回的图片格式当前不支持。"
  });
}

export function providerTimeout() {
  throw new ImageApiError({
    statusCode: 504,
    status: "failed",
    errorCode: "IMAGE_PROVIDER_TIMEOUT",
    message: "图片生成超时，请稍后重试。"
  });
}

export function publicErrorPayload(error, fallbackRequestId = "") {
  if (error instanceof ImageApiError) {
    return {
      statusCode: error.statusCode,
      payload: {
        request_id: fallbackRequestId,
        status: error.status,
        error_code: error.errorCode,
        message: error.message
      }
    };
  }
  return {
    statusCode: 500,
    payload: {
      request_id: fallbackRequestId,
      status: "failed",
      error_code: "INTERNAL_ERROR",
      message: "服务内部错误。"
    }
  };
}
