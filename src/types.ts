import type { Readable } from 'node:stream';

/**
 * TLS/SSL configuration options for secure connections.
 */
export interface TlsOptions {
  /** CA certificate(s) for server verification. */
  ca?: string | Buffer;
  /** Client certificate for mutual TLS. */
  cert?: string | Buffer;
  /** Client private key for mutual TLS. */
  key?: string | Buffer;
  /** Whether to reject unauthorized certificates. Default: true. */
  rejectUnauthorized?: boolean;
}

/**
 * gRPC-specific configuration options.
 */
export interface GrpcOptions {
  /** Max send message size in bytes. Default: 209715200 (200MB). */
  maxSendMessageSize?: number;
  /** Max receive message size in bytes. Default: 209715200 (200MB). */
  maxReceiveMessageSize?: number;
}

/**
 * Configuration options for ClamAV SDK clients.
 */
export interface ClamAVClientOptions {
  /** Base URL for REST (e.g. "http://localhost:6000") or host:port for gRPC (e.g. "localhost:9000"). */
  url: string;

  /** Request timeout in milliseconds. Default: 300000 (5 minutes). */
  timeout?: number;

  /** Custom HTTP headers (REST only). */
  headers?: Record<string, string>;

  /** TLS/SSL options for secure connections. */
  tls?: TlsOptions;

  /** gRPC-specific options. */
  grpc?: GrpcOptions;

  /** Explicit transport selection. If omitted, auto-detected from URL scheme. */
  transport?: 'rest' | 'grpc';
}

/**
 * Options that can be passed to individual method calls.
 */
export interface RequestOptions {
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
  /** Per-request timeout override in milliseconds. */
  timeout?: number;
}

/**
 * Result of a health check request.
 */
export interface HealthCheckResult {
  /** Whether the ClamAV service is healthy. */
  healthy: boolean;
  /** Status message from the service. */
  message: string;
}

/**
 * Result of a version request (REST only).
 */
export interface VersionResult {
  /** ClamAV API version string. */
  version: string;
  /** Git commit hash. */
  commit: string;
  /** Build timestamp. */
  build: string;
}

/**
 * Result of a file scan operation.
 */
export interface ScanResult {
  /** Scan status: "OK" = clean, "FOUND" = infected, "ERROR" = scan error. */
  status: 'OK' | 'FOUND' | 'ERROR';
  /** Virus signature name if infected, error message if error, empty if clean. */
  message: string;
  /** Scan duration in seconds. */
  scanTime: number;
  /** Filename if provided. */
  filename?: string;
  /** Convenience boolean: true if status is "FOUND". */
  isInfected: boolean;
}

/**
 * A file entry for scanning multiple files.
 */
export interface FileEntry {
  /** File contents as a Buffer. */
  data: Buffer;
  /** Filename for identification. */
  filename: string;
}

/**
 * Common interface implemented by both REST and gRPC clients.
 */
export interface IClamAVClient {
  /** Check if the ClamAV service is healthy. */
  healthCheck(options?: RequestOptions): Promise<HealthCheckResult>;

  /** Get version information (REST only; gRPC throws "not supported"). */
  version(options?: RequestOptions): Promise<VersionResult>;

  /**
   * Scan a file. Accepts a Buffer or a file path (string).
   * If a file path is given, the file is read from disk automatically.
   */
  scanFile(
    input: Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult>;

  /**
   * Scan a file via streaming. Accepts a Readable stream, Buffer, or file path.
   * Ideal for large files — data is streamed without full buffering.
   */
  scanStream(
    input: Readable | Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult>;

  /**
   * Scan multiple files. gRPC uses bidirectional streaming; REST falls back to parallel scanFile calls.
   * Returns results as an async iterable for back-pressure support.
   */
  scanMultiple(files: FileEntry[], options?: RequestOptions): AsyncIterable<ScanResult>;

  /** Close the client and release resources. */
  close(): Promise<void>;
}
