import { describe, it, expect } from 'vitest';
import {
  ClamAVError,
  ClamAVConnectionError,
  ClamAVTimeoutError,
  ClamAVValidationError,
  ClamAVServiceError,
} from '../../src/errors.js';

describe('ClamAVError', () => {
  it('should set message, code, and statusCode', () => {
    const error = new ClamAVError('test error', 'TEST_CODE', 500);
    expect(error.message).toBe('test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('ClamAVError');
  });

  it('should be an instance of Error', () => {
    const error = new ClamAVError('test', 'CODE');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ClamAVError);
  });

  it('should attach cause', () => {
    const cause = new Error('original');
    const error = new ClamAVError('wrapped', 'CODE', undefined, cause);
    expect(error.cause).toBe(cause);
  });

  it('should have undefined statusCode when not provided', () => {
    const error = new ClamAVError('test', 'CODE');
    expect(error.statusCode).toBeUndefined();
  });
});

describe('ClamAVConnectionError', () => {
  it('should have correct name and code', () => {
    const error = new ClamAVConnectionError('cannot connect');
    expect(error.name).toBe('ClamAVConnectionError');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.statusCode).toBeUndefined();
  });

  it('should be instanceof ClamAVError', () => {
    const error = new ClamAVConnectionError('test');
    expect(error).toBeInstanceOf(ClamAVError);
    expect(error).toBeInstanceOf(ClamAVConnectionError);
  });

  it('should attach cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new ClamAVConnectionError('failed', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('ClamAVTimeoutError', () => {
  it('should have correct name and code', () => {
    const error = new ClamAVTimeoutError('timed out', 504);
    expect(error.name).toBe('ClamAVTimeoutError');
    expect(error.code).toBe('TIMEOUT');
    expect(error.statusCode).toBe(504);
  });

  it('should be instanceof ClamAVError', () => {
    const error = new ClamAVTimeoutError('test');
    expect(error).toBeInstanceOf(ClamAVError);
    expect(error).toBeInstanceOf(ClamAVTimeoutError);
  });
});

describe('ClamAVValidationError', () => {
  it('should have correct name and code', () => {
    const error = new ClamAVValidationError('file too large', 413);
    expect(error.name).toBe('ClamAVValidationError');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(413);
  });

  it('should be instanceof ClamAVError', () => {
    const error = new ClamAVValidationError('test');
    expect(error).toBeInstanceOf(ClamAVError);
    expect(error).toBeInstanceOf(ClamAVValidationError);
  });
});

describe('ClamAVServiceError', () => {
  it('should have correct name and code', () => {
    const error = new ClamAVServiceError('daemon down', 502);
    expect(error.name).toBe('ClamAVServiceError');
    expect(error.code).toBe('SERVICE_ERROR');
    expect(error.statusCode).toBe(502);
  });

  it('should be instanceof ClamAVError', () => {
    const error = new ClamAVServiceError('test');
    expect(error).toBeInstanceOf(ClamAVError);
    expect(error).toBeInstanceOf(ClamAVServiceError);
  });

  it('should attach cause', () => {
    const cause = new Error('clamd unavailable');
    const error = new ClamAVServiceError('service down', 502, cause);
    expect(error.cause).toBe(cause);
  });
});
