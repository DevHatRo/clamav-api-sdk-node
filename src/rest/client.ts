import type { Readable } from 'node:stream';
import type {
  ClamAVClientOptions,
  FileEntry,
  HealthCheckResult,
  IClamAVClient,
  RequestOptions,
  ScanResult,
  VersionResult,
} from '../types.js';
import {
  ClamAVConnectionError,
  ClamAVError,
  ClamAVServiceError,
  ClamAVTimeoutError,
  ClamAVValidationError,
} from '../errors.js';
import { resolveInput } from '../utils/validation.js';
import { streamToBuffer } from '../utils/stream.js';

/**
 * ClamAV REST API client.
 * Communicates with the ClamAV API service over HTTP using the REST endpoints.
 */
export class ClamAVRestClient implements IClamAVClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(options: ClamAVClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 300_000;
    this.headers = options.headers ?? {};
  }

  async healthCheck(options?: RequestOptions): Promise<HealthCheckResult> {
    try {
      const response = await this.fetch('/api/health-check', { method: 'GET' }, options);
      const body = (await response.json()) as { message: string };

      return {
        healthy: response.ok && body.message === 'ok',
        message: body.message,
      };
    } catch (error) {
      if (error instanceof ClamAVError) throw error;
      throw new ClamAVConnectionError('Failed to connect to ClamAV API', error);
    }
  }

  async version(options?: RequestOptions): Promise<VersionResult> {
    try {
      const response = await this.fetch('/api/version', { method: 'GET' }, options);
      this.assertOk(response);
      const body = (await response.json()) as VersionResult;
      return body;
    } catch (error) {
      if (error instanceof ClamAVError) throw error;
      throw new ClamAVConnectionError('Failed to connect to ClamAV API', error);
    }
  }

  async scanFile(
    input: Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    try {
      const resolved = await resolveInput(input, filename);
      const buffer = resolved.buffer ?? (await streamToBuffer(resolved.stream));

      const formData = new FormData();
      const blob = new Blob([buffer]);
      formData.append('file', blob, resolved.filename);

      const response = await this.fetch(
        '/api/scan',
        {
          method: 'POST',
          body: formData,
        },
        options,
      );

      return this.parseScanResponse(response, resolved.filename);
    } catch (error) {
      if (error instanceof ClamAVError) throw error;
      throw new ClamAVConnectionError('Failed to connect to ClamAV API', error);
    }
  }

  async scanStream(
    input: Readable | Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    try {
      const resolved = await resolveInput(input, filename);
      const buffer = resolved.buffer ?? (await streamToBuffer(resolved.stream));

      const response = await this.fetch(
        '/api/stream-scan',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.length),
          },
          body: buffer,
        },
        options,
      );

      return this.parseScanResponse(response, resolved.filename);
    } catch (error) {
      if (error instanceof ClamAVError) throw error;
      throw new ClamAVConnectionError('Failed to connect to ClamAV API', error);
    }
  }

  async *scanMultiple(files: FileEntry[], options?: RequestOptions): AsyncIterable<ScanResult> {
    const promises = files.map((file) => this.scanFile(file.data, file.filename, options));

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        yield result.value;
      } else {
        const err = result.reason;
        yield {
          status: 'ERROR',
          message: err instanceof Error ? err.message : String(err),
          scanTime: 0,
          isInfected: false,
        };
      }
    }
  }

  async close(): Promise<void> {
    // No persistent connections to clean up for HTTP
  }

  private async fetch(
    path: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const timeout = options?.timeout ?? this.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Link external signal if provided
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), {
          once: true,
        });
      }
    }

    const headers: Record<string, string> = {
      ...this.headers,
      ...(init.headers as Record<string, string>),
    };

    try {
      const response = await globalThis.fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (options?.signal?.aborted) {
          throw new ClamAVError('Request was cancelled', 'CANCELLED', 499, error);
        }
        throw new ClamAVTimeoutError(`Request timed out after ${timeout}ms`, 504, error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseScanResponse(response: Response, filename?: string): Promise<ScanResult> {
    const body = (await response.json()) as {
      status?: string;
      message?: string;
      time?: number;
    };

    await this.handleErrorStatus(response, body);

    const status = (body.status ?? 'ERROR') as ScanResult['status'];
    return {
      status,
      message: body.message ?? '',
      scanTime: body.time ?? 0,
      filename,
      isInfected: status === 'FOUND',
    };
  }

  private async handleErrorStatus(
    response: Response,
    body: { status?: string; message?: string },
  ): Promise<void> {
    if (response.ok) return;

    const message = body.message ?? body.status ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 400:
        throw new ClamAVValidationError(message, 400);
      case 413:
        throw new ClamAVValidationError(message, 413);
      case 499:
        throw new ClamAVError(message, 'CANCELLED', 499);
      case 502:
        throw new ClamAVServiceError(message, 502);
      case 504:
        throw new ClamAVTimeoutError(message, 504);
      default:
        throw new ClamAVError(message, 'UNKNOWN', response.status);
    }
  }

  private assertOk(response: Response): void {
    if (!response.ok) {
      throw new ClamAVError(`HTTP ${response.status}`, 'UNKNOWN', response.status);
    }
  }
}
