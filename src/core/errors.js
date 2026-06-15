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

export function v36ImageGenerationErrorPayload(error) {
  const mapped = mapV36ImageGenerationError(error);
  return {
    statusCode: mapped.statusCode,
    payload: {
      status: mapped.status,
      error: {
        code: mapped.code,
        message: mapped.message
      },
      images: [],
      warnings: []
    }
  };
}

export function mapV36ImageGenerationError(error) {
  const sourceCode = error instanceof ImageApiError ? error.errorCode : "INTERNAL_ERROR";
  const sourceStatus = error instanceof ImageApiError ? error.statusCode : 500;
  const sourceStatusText = error instanceof ImageApiError ? error.status : "failed";
  const clientCodes = new Set([
    "INVALID_REQUEST_SCHEMA",
    "UNSUPPORTED_TASK_TYPE",
    "PROMPT_REQUIRED",
    "PROMPT_TOO_LONG",
    "REFERENCES_NOT_ALLOWED",
    "REFERENCE_REQUIRED",
    "DUPLICATE_REFERENCE_ID",
    "REFERENCE_ID_REQUIRED",
    "REFERENCE_ENTITY_NAME_REQUIRED",
    "REFERENCE_ENTITY_TYPE_INVALID",
    "INVALID_REFERENCE_ROLE",
    "REFERENCE_ROLE_INVALID",
    "REFERENCE_URL_REQUIRED",
    "REFERENCE_URL_INVALID",
    "ENTITY_REFERENCE_NOT_FOUND",
    "CALLBACK_URL_INVALID",
    "PUBLIC_BASE_URL_INVALID",
    "PUBLIC_BASE_URL_REQUIRED"
  ]);
  if (error instanceof ImageApiError && sourceStatus < 500 && clientCodes.has(sourceCode)) {
    return {
      statusCode: sourceStatus,
      status: sourceStatusText,
      code: sourceCode,
      message: error.message
    };
  }
  if (error instanceof ImageApiError && sourceCode === "PUBLIC_BASE_URL_REQUIRED") {
    return {
      statusCode: sourceStatus,
      status: sourceStatusText,
      code: sourceCode,
      message: error.message
    };
  }
  const table = {
    PROVIDER_CONFIG_MISSING: ["PROMPT_IMAGE_BACKEND_NOT_CONFIGURED", "提示词优化生图后端未配置。"],
    REFERENCE_IMAGE_NOT_ACCESSIBLE: ["REFERENCE_IMAGE_URL_NOT_ACCESSIBLE_BY_BACKEND", "参考图地址无法被生图服务访问，请检查参考图上传配置。"],
    REFERENCE_IMAGE_UNSUPPORTED: ["REFERENCE_IMAGE_URL_NOT_ACCESSIBLE_BY_BACKEND", "参考图地址无法被生图服务访问，请检查参考图上传配置。"],
    REFERENCE_IMAGE_TOO_LARGE: ["REFERENCE_IMAGE_URL_NOT_ACCESSIBLE_BY_BACKEND", "参考图地址无法被生图服务访问，请检查参考图上传配置。"],
    IMAGE_PROVIDER_TIMEOUT: ["PROMPT_IMAGE_BACKEND_TIMEOUT", "生成超时，请稍后重试。"],
    IMAGE_PROVIDER_CALL_FAILED: ["PROMPT_IMAGE_BACKEND_UNAVAILABLE", "生图服务暂时不可用，请稍后重试。"],
    PROVIDER_RESPONSE_UNSUPPORTED: ["PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。"],
    IMAGE_RESULT_EMPTY: ["PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。"],
    PROVIDER_IMAGE_URL_UNSAFE: ["PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。"]
  };
  const [code, message] = table[sourceCode] || ["PROMPT_IMAGE_BACKEND_INVALID_RESPONSE", "生成结果格式暂不支持。"];
  const statusByCode = {
    PROMPT_IMAGE_BACKEND_NOT_CONFIGURED: 503,
    REFERENCE_IMAGE_URL_NOT_ACCESSIBLE_BY_BACKEND: 400,
    PROMPT_IMAGE_BACKEND_TIMEOUT: 504,
    PROMPT_IMAGE_BACKEND_UNAVAILABLE: 502,
    PROMPT_IMAGE_BACKEND_INVALID_RESPONSE: 502
  };
  return {
    statusCode: statusByCode[code] || (sourceStatus >= 400 ? sourceStatus : 502),
    status: "failed",
    code,
    message
  };
}
