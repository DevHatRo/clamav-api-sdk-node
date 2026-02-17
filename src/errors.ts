/**
 * Base error class for all ClamAV SDK errors.
 */
export class ClamAVError extends Error {
  /** Machine-readable error code. */
  readonly code: string;
  /** HTTP status code or gRPC status code, if applicable. */
  readonly statusCode?: number;

  constructor(message: string, code: string, statusCode?: number, cause?: unknown) {
    super(message, { cause });
    this.name = 'ClamAVError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when the SDK cannot connect to the ClamAV API server.
 */
export class ClamAVConnectionError extends ClamAVError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONNECTION_ERROR', undefined, cause);
    this.name = 'ClamAVConnectionError';
  }
}

/**
 * Thrown when a scan operation exceeds the configured timeout.
 */
export class ClamAVTimeoutError extends ClamAVError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, 'TIMEOUT', statusCode, cause);
    this.name = 'ClamAVTimeoutError';
  }
}

/**
 * Thrown for client-side validation errors (e.g., file too large, missing data).
 */
export class ClamAVValidationError extends ClamAVError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', statusCode, cause);
    this.name = 'ClamAVValidationError';
  }
}

/**
 * Thrown when the ClamAV daemon is unavailable (HTTP 502, gRPC INTERNAL).
 */
export class ClamAVServiceError extends ClamAVError {
  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message, 'SERVICE_ERROR', statusCode, cause);
    this.name = 'ClamAVServiceError';
  }
}
