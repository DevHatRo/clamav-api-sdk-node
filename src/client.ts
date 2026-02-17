import type { Readable } from 'node:stream';
import type {
  ClamAVClientOptions,
  FileEntry,
  HealthCheckResult,
  IClamAVClient,
  RequestOptions,
  ScanResult,
  VersionResult,
} from './types.js';
import { ClamAVRestClient } from './rest/client.js';
import { ClamAVGrpcClient } from './grpc/client.js';

/**
 * Convenience ClamAV client that auto-detects transport from the URL scheme.
 *
 * - URLs starting with `http://` or `https://` use the REST client.
 * - All other URLs (e.g. `localhost:9000`) use the gRPC client.
 * - Override with the explicit `transport` option.
 */
export class ClamAV implements IClamAVClient {
  private readonly inner: IClamAVClient;

  constructor(options: ClamAVClientOptions) {
    const transport = options.transport ?? this.detectTransport(options.url);

    if (transport === 'grpc') {
      this.inner = new ClamAVGrpcClient(options);
    } else {
      this.inner = new ClamAVRestClient(options);
    }
  }

  healthCheck(options?: RequestOptions): Promise<HealthCheckResult> {
    return this.inner.healthCheck(options);
  }

  version(options?: RequestOptions): Promise<VersionResult> {
    return this.inner.version(options);
  }

  scanFile(
    input: Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    return this.inner.scanFile(input, filename, options);
  }

  scanStream(
    input: Readable | Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    return this.inner.scanStream(input, filename, options);
  }

  scanMultiple(files: FileEntry[], options?: RequestOptions): AsyncIterable<ScanResult> {
    return this.inner.scanMultiple(files, options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  private detectTransport(url: string): 'rest' | 'grpc' {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return 'rest';
    }
    return 'grpc';
  }
}
