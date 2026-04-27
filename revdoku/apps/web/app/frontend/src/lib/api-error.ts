// API Error handling utilities for standardized error responses

/**
 * Standardized API error response format
 */
export interface ApiErrorResponse {
  error: {
    message: string;
    code?: string;
    timestamp?: string;
    request_id?: string;
    details?: Array<{
      field: string;
      message: string;
    }>;
  };
}

/**
 * Legacy error formats (for backward compatibility)
 */
export interface LegacyErrorResponse {
  error: string;
  errors: string[] | string;
}

/**
 * Custom API Error class that preserves all error information
 */
export class ApiError extends Error {
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly details?: Array<{ field: string; message: string }>;
  public readonly timestamp?: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      code?: string;
      requestId?: string;
      details?: Array<{ field: string; message: string }>;
      timestamp?: string;
      statusCode?: number;
    } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
    this.timestamp = options.timestamp;
    this.statusCode = options.statusCode;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Get formatted error message for display to users
   */
  public getDisplayMessage(): string {
    return this.message;
  }

  /**
   * Get validation errors as a formatted string
   */
  public getValidationMessages(): string[] {
    if (!this.details) return [];
    return this.details.map(detail => `${detail.field}: ${detail.message}`);
  }

  /**
   * Check if this is a specific error code
   */
  public isErrorCode(code: string): boolean {
    return this.code === code;
  }

  /**
   * Check if this is a validation error
   */
  public isValidationError(): boolean {
    return this.code === 'VALIDATION_ERROR' || !!(this.details && this.details.length > 0);
  }

  /**
   * Get debug information for logging
   */
  public getDebugInfo(): object {
    return {
      message: this.message,
      code: this.code,
      requestId: this.requestId,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      details: this.details
    };
  }
}

/**
 * Parse API error response and create ApiError instance
 * Handles both new standardized format and legacy formats
 */
export async function parseApiError(response: Response): Promise<ApiError> {
  const statusCode = response.status;
  const defaultMessage = `API request failed with status ${statusCode}`;

  try {
    const errorData = await response.json();

    // Handle new standardized error format
    if (errorData.error && typeof errorData.error === 'object' && errorData.error.message) {
      return new ApiError(errorData.error.message, {
        code: errorData.error.code,
        requestId: errorData.error.request_id,
        details: errorData.error.details,
        timestamp: errorData.error.timestamp,
        statusCode
      });
    }

    // Handle legacy format: { error: "string" }
    if (errorData.error && typeof errorData.error === 'string') {
      return new ApiError(errorData.error, { statusCode });
    }

    // Handle legacy format: { errors: ["string"] } or { errors: "string" }
    if (errorData.errors) {
      const message = Array.isArray(errorData.errors) 
        ? errorData.errors.join(', ')
        : errorData.errors.toString();
      return new ApiError(message, { statusCode });
    }

    // Handle cases where error data exists but doesn't match expected format
    const message = errorData.message || JSON.stringify(errorData) || defaultMessage;
    return new ApiError(message, { statusCode });

  } catch (parseError) {
    // If response body is not valid JSON or empty, use status text
    const message = response.statusText || defaultMessage;
    return new ApiError(message, { statusCode });
  }
}

/**
 * Create ApiError from a generic error (for try/catch blocks)
 */
export function createApiError(error: unknown, context = 'API request failed'): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApiError(`${context}: ${error.message}`);
  }

  return new ApiError(`${context}: ${String(error)}`);
}

/**
 * Log API error with request ID for debugging
 */
export function logApiError(error: ApiError, context?: string): void {
  const prefix = context ? `[${context}]` : '[API Error]';
  const debugInfo = error.getDebugInfo();

  console.error(prefix, debugInfo);

  // Log request ID separately for easy searching
  if (error.requestId) {
    console.error(`Request ID: ${error.requestId}`);
  }
}