import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
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
import { chunkStream } from '../utils/stream.js';

const CHUNK_SIZE = 64 * 1024; // 64KB
const DEFAULT_MAX_MESSAGE_SIZE = 200 * 1024 * 1024; // 200MB

interface GrpcScanResponse {
  status: string;
  message: string;
  scan_time: number;
  filename: string;
}

interface GrpcHealthCheckResponse {
  status: string;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GrpcClient = any;

/**
 * ClamAV gRPC API client.
 * Communicates with the ClamAV API service over gRPC using Protocol Buffers.
 */
export class ClamAVGrpcClient implements IClamAVClient {
  private readonly client: GrpcClient;
  private readonly timeout: number;

  constructor(options: ClamAVClientOptions) {
    this.timeout = options.timeout ?? 300_000;

    const protoPath = findProtoPath();

    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clamav = protoDescriptor.clamav as any;

    const maxSend = options.grpc?.maxSendMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
    const maxRecv = options.grpc?.maxReceiveMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;

    let credentials: grpc.ChannelCredentials;
    if (options.tls) {
      credentials = grpc.credentials.createSsl(
        options.tls.ca ? Buffer.from(options.tls.ca) : undefined,
        options.tls.key ? Buffer.from(options.tls.key) : undefined,
        options.tls.cert ? Buffer.from(options.tls.cert) : undefined,
      );
    } else {
      credentials = grpc.credentials.createInsecure();
    }

    this.client = new clamav.ClamAVScanner(options.url, credentials, {
      'grpc.max_send_message_length': maxSend,
      'grpc.max_receive_message_length': maxRecv,
    });
  }

  async healthCheck(options?: RequestOptions): Promise<HealthCheckResult> {
    return new Promise<HealthCheckResult>((resolve, reject) => {
      const metadata = new grpc.Metadata();
      const callOptions = this.buildCallOptions(options);

      const call = this.client.healthCheck(
        {},
        metadata,
        callOptions,
        (error: grpc.ServiceError | null, response: GrpcHealthCheckResponse) => {
          if (error) {
            reject(this.mapGrpcError(error));
            return;
          }
          resolve({
            healthy: response.status === 'healthy',
            message: response.message || response.status,
          });
        },
      );

      this.wireAbortSignal(call, options?.signal);
    });
  }

  async version(_options?: RequestOptions): Promise<VersionResult> {
    throw new ClamAVValidationError('version() is not supported over gRPC');
  }

  async scanFile(
    input: Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    const resolved = await resolveInput(input, filename);
    const buffer = resolved.buffer ?? (await this.collectStream(resolved.stream));

    return new Promise<ScanResult>((resolve, reject) => {
      const metadata = new grpc.Metadata();
      const callOptions = this.buildCallOptions(options);

      const call = this.client.scanFile(
        { data: buffer, filename: resolved.filename },
        metadata,
        callOptions,
        (error: grpc.ServiceError | null, response: GrpcScanResponse) => {
          if (error) {
            reject(this.mapGrpcError(error));
            return;
          }
          resolve(this.toScanResult(response));
        },
      );

      this.wireAbortSignal(call, options?.signal);
    });
  }

  async scanStream(
    input: Readable | Buffer | string,
    filename?: string,
    options?: RequestOptions,
  ): Promise<ScanResult> {
    const resolved = await resolveInput(input, filename);

    return new Promise<ScanResult>((resolve, reject) => {
      const callOptions = this.buildCallOptions(options);
      const call = this.client.scanStream(
        callOptions,
        (error: grpc.ServiceError | null, response: GrpcScanResponse) => {
          if (error) {
            reject(this.mapGrpcError(error));
            return;
          }
          resolve(this.toScanResult(response));
        },
      );

      this.wireAbortSignal(call, options?.signal);

      const stream = resolved.buffer ? Readable.from(resolved.buffer) : resolved.stream;

      this.sendStreamChunks(call, stream, resolved.filename).catch((err) => {
        call.cancel();
        reject(err);
      });
    });
  }

  async *scanMultiple(files: FileEntry[], options?: RequestOptions): AsyncIterable<ScanResult> {
    const state = {
      results: [] as ScanResult[],
      resolveNext: null as (() => void) | null,
      done: false,
      error: null as Error | null,
    };

    const notify = () => {
      state.resolveNext?.();
    };

    const callOptions = this.buildCallOptions(options);
    const call = this.client.scanMultiple(callOptions);

    this.wireAbortSignal(call, options?.signal);

    call.on('data', (response: GrpcScanResponse) => {
      state.results.push(this.toScanResult(response));
      notify();
    });

    call.on('error', (error: grpc.ServiceError) => {
      state.error = this.mapGrpcError(error);
      state.done = true;
      notify();
    });

    call.on('end', () => {
      state.done = true;
      notify();
    });

    // Send all files as chunks
    (async () => {
      try {
        for (const file of files) {
          const stream = Readable.from(file.data);
          await this.sendStreamChunks(call, stream, file.filename);
        }
        call.end();
      } catch (err) {
        state.error = err instanceof Error ? err : new Error(String(err));
        state.done = true;
        call.cancel();
        notify();
      }
    })();

    let yielded = 0;
    while (true) {
      if (yielded < state.results.length) {
        yield state.results[yielded++];
        continue;
      }

      if (state.done && yielded >= state.results.length) {
        if (state.error) throw state.error;
        return;
      }

      await new Promise<void>((r) => {
        state.resolveNext = r;
      });
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }

  private async sendStreamChunks(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: any,
    stream: Readable,
    filename: string,
  ): Promise<void> {
    let prevChunk: Buffer | null = null;
    let isFirst = true;

    for await (const chunk of chunkStream(stream, CHUNK_SIZE)) {
      if (prevChunk !== null) {
        call.write({
          chunk: prevChunk,
          filename: isFirst ? filename : '',
          isLast: false,
        });
        isFirst = false;
      }
      prevChunk = chunk;
    }

    if (prevChunk !== null) {
      call.write({
        chunk: prevChunk,
        filename: isFirst ? filename : '',
        isLast: true,
      });
    }
  }

  private buildCallOptions(options?: RequestOptions): grpc.CallOptions {
    const timeout = options?.timeout ?? this.timeout;
    const deadline = new Date(Date.now() + timeout);
    return { deadline };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wireAbortSignal(call: any, signal?: AbortSignal): void {
    if (!signal) return;
    if (signal.aborted) {
      call.cancel();
      return;
    }
    signal.addEventListener('abort', () => call.cancel(), { once: true });
  }

  private toScanResult(response: GrpcScanResponse): ScanResult {
    const status = (response.status || 'ERROR') as ScanResult['status'];
    return {
      status,
      message: response.message || '',
      scanTime: response.scan_time || 0,
      filename: response.filename || undefined,
      isInfected: status === 'FOUND',
    };
  }

  private mapGrpcError(error: grpc.ServiceError): ClamAVError {
    const message = error.details || error.message;

    switch (error.code) {
      case grpc.status.INVALID_ARGUMENT:
        return new ClamAVValidationError(message, error.code, error);
      case grpc.status.INTERNAL:
        return new ClamAVServiceError(message, error.code, error);
      case grpc.status.DEADLINE_EXCEEDED:
        return new ClamAVTimeoutError(message, error.code, error);
      case grpc.status.UNAVAILABLE:
        return new ClamAVConnectionError(message, error);
      case grpc.status.CANCELLED:
        return new ClamAVError(message, 'CANCELLED', error.code, error);
      default:
        return new ClamAVError(message, 'GRPC_ERROR', error.code, error);
    }
  }

  private async collectStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Locate the bundled clamav.proto file, supporting both ESM and CJS environments.
 */
function findProtoPath(): string {
  // Try ESM path resolution first
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const esmPath = resolve(currentDir, '../../proto/clamav.proto');
    if (existsSync(esmPath)) return esmPath;
  } catch {
    // import.meta.url not available in CJS
  }

  // CJS fallback: use __dirname if available
  try {
    const cjsPath = resolve(__dirname, '../../proto/clamav.proto');
    if (existsSync(cjsPath)) return cjsPath;
  } catch {
    // __dirname not available in ESM
  }

  // Last resort: resolve from cwd
  const cwdPath = join(process.cwd(), 'proto/clamav.proto');
  if (existsSync(cwdPath)) return cwdPath;

  // Search in node_modules
  const nmPath = join(process.cwd(), 'node_modules/@devhatro/clamav-api-sdk/proto/clamav.proto');
  if (existsSync(nmPath)) return nmPath;

  throw new Error(
    'Could not locate clamav.proto. Ensure the proto/ directory is present alongside the package.',
  );
}
