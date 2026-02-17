import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { ClamAVGrpcClient } from '../../src/grpc/client.js';
import {
  ClamAVConnectionError,
  ClamAVError,
  ClamAVServiceError,
  ClamAVTimeoutError,
  ClamAVValidationError,
} from '../../src/errors.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Callback = (...args: any[]) => void;

// Mock the gRPC and proto-loader modules
vi.mock('@grpc/grpc-js', async () => {
  const actual = await vi.importActual<typeof grpc>('@grpc/grpc-js');
  return {
    ...actual,
    credentials: {
      createInsecure: vi.fn(() => ({})),
      createSsl: vi.fn(() => ({})),
    },
    loadPackageDefinition: vi.fn(() => ({
      clamav: {
        ClamAVScanner: vi.fn(() => mockClient),
      },
    })),
    Metadata: actual.Metadata,
    status: actual.status,
  };
});

vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn(() => ({})),
}));

const mockClient = {
  healthCheck: vi.fn(),
  scanFile: vi.fn(),
  scanStream: vi.fn(),
  scanMultiple: vi.fn(),
  close: vi.fn(),
};

describe('ClamAVGrpcClient', () => {
  let client: ClamAVGrpcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ClamAVGrpcClient({ url: 'localhost:9000' });
  });

  afterEach(async () => {
    await client.close();
  });

  describe('healthCheck', () => {
    it('should return healthy when service responds', async () => {
      mockClient.healthCheck.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          cb(null, { status: 'healthy', message: '' });
          return { cancel: vi.fn() };
        },
      );

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('healthy');
    });

    it('should return unhealthy status', async () => {
      mockClient.healthCheck.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          cb(null, { status: 'unhealthy', message: 'clamd not running' });
          return { cancel: vi.fn() };
        },
      );

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe('clamd not running');
    });

    it('should throw ClamAVConnectionError on UNAVAILABLE', async () => {
      mockClient.healthCheck.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          const error = Object.assign(new Error('unavailable'), {
            code: grpc.status.UNAVAILABLE,
            details: 'Connection refused',
          });
          cb(error);
          return { cancel: vi.fn() };
        },
      );

      await expect(client.healthCheck()).rejects.toThrow(ClamAVConnectionError);
    });
  });

  describe('version', () => {
    it('should throw ClamAVValidationError', async () => {
      await expect(client.version()).rejects.toThrow(ClamAVValidationError);
      await expect(client.version()).rejects.toThrow('not supported over gRPC');
    });
  });

  describe('scanFile', () => {
    it('should scan a clean file', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          cb(null, {
            status: 'OK',
            message: '',
            scan_time: 0.001,
            filename: 'clean.txt',
          });
          return { cancel: vi.fn() };
        },
      );

      const result = await client.scanFile(Buffer.from('clean'), 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
      expect(result.scanTime).toBe(0.001);
      expect(result.filename).toBe('clean.txt');
    });

    it('should detect an infected file', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          cb(null, {
            status: 'FOUND',
            message: 'Eicar-Test-Signature',
            scan_time: 0.002,
            filename: 'eicar.txt',
          });
          return { cancel: vi.fn() };
        },
      );

      const result = await client.scanFile(Buffer.from('eicar'), 'eicar.txt');

      expect(result.status).toBe('FOUND');
      expect(result.isInfected).toBe(true);
      expect(result.message).toBe('Eicar-Test-Signature');
    });

    it('should throw ClamAVValidationError on INVALID_ARGUMENT', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          const error = Object.assign(new Error('invalid'), {
            code: grpc.status.INVALID_ARGUMENT,
            details: 'file data is required',
          });
          cb(error);
          return { cancel: vi.fn() };
        },
      );

      await expect(client.scanFile(Buffer.from(''), 'empty.txt')).rejects.toThrow(
        ClamAVValidationError,
      );
    });

    it('should throw ClamAVServiceError on INTERNAL', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          const error = Object.assign(new Error('internal'), {
            code: grpc.status.INTERNAL,
            details: 'scan failed: clamd unavailable',
          });
          cb(error);
          return { cancel: vi.fn() };
        },
      );

      await expect(client.scanFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        ClamAVServiceError,
      );
    });

    it('should throw ClamAVTimeoutError on DEADLINE_EXCEEDED', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          const error = Object.assign(new Error('timeout'), {
            code: grpc.status.DEADLINE_EXCEEDED,
            details: 'scan operation timed out',
          });
          cb(error);
          return { cancel: vi.fn() };
        },
      );

      await expect(client.scanFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        ClamAVTimeoutError,
      );
    });

    it('should throw ClamAVError on CANCELLED', async () => {
      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, cb: Callback) => {
          const error = Object.assign(new Error('cancelled'), {
            code: grpc.status.CANCELLED,
            details: 'request canceled by client',
          });
          cb(error);
          return { cancel: vi.fn() };
        },
      );

      const err = await client
        .scanFile(Buffer.from('test'), 'test.txt')
        .catch((e: ClamAVError) => e);
      expect(err).toBeInstanceOf(ClamAVError);
      expect(err.code).toBe('CANCELLED');
    });
  });

  describe('scanStream', () => {
    it('should stream chunks and return result', async () => {
      const mockCall = {
        write: vi.fn(),
        end: vi.fn(),
        cancel: vi.fn(),
      };

      mockClient.scanStream.mockImplementation((_opts: unknown, cb: Callback) => {
        setTimeout(() => {
          cb(null, {
            status: 'OK',
            message: '',
            scan_time: 0.005,
            filename: 'streamed.txt',
          });
        }, 10);
        return mockCall;
      });

      const result = await client.scanStream(Buffer.from('stream data'), 'streamed.txt');

      expect(result.status).toBe('OK');
      expect(mockCall.write).toHaveBeenCalled();
    });

    it('should chunk large buffers', async () => {
      const mockCall = {
        write: vi.fn(),
        end: vi.fn(),
        cancel: vi.fn(),
      };

      mockClient.scanStream.mockImplementation((_opts: unknown, cb: Callback) => {
        setTimeout(() => {
          cb(null, { status: 'OK', message: '', scan_time: 0.01, filename: 'large.bin' });
        }, 10);
        return mockCall;
      });

      // 150KB buffer should be chunked into 3 x 64KB parts (64 + 64 + 22)
      const largeBuffer = Buffer.alloc(150 * 1024, 'x');
      const result = await client.scanStream(largeBuffer, 'large.bin');

      expect(result.status).toBe('OK');
      expect(mockCall.write.mock.calls.length).toBe(3);

      // First chunk should have filename
      const firstCall = mockCall.write.mock.calls[0][0];
      expect(firstCall.filename).toBe('large.bin');
      expect(firstCall.isLast).toBe(false);

      // Last chunk should have isLast = true
      const lastCall = mockCall.write.mock.calls[2][0];
      expect(lastCall.isLast).toBe(true);
    });
  });

  describe('scanMultiple', () => {
    it('should stream multiple files and yield results', async () => {
      const mockCall = {
        write: vi.fn(),
        end: vi.fn(),
        cancel: vi.fn(),
        on: vi.fn(),
      };

      let dataHandler: Callback = () => {};
      let endHandler: Callback = () => {};

      mockCall.on.mockImplementation((event: string, handler: Callback) => {
        if (event === 'data') dataHandler = handler;
        if (event === 'end') endHandler = handler;
        return mockCall;
      });

      mockClient.scanMultiple.mockImplementation(() => {
        setTimeout(() => {
          dataHandler({ status: 'OK', message: '', scan_time: 0.001, filename: 'file1.txt' });
          dataHandler({
            status: 'FOUND',
            message: 'Eicar',
            scan_time: 0.002,
            filename: 'file2.txt',
          });
          endHandler();
        }, 20);
        return mockCall;
      });

      const files = [
        { data: Buffer.from('clean'), filename: 'file1.txt' },
        { data: Buffer.from('eicar'), filename: 'file2.txt' },
      ];

      const results: Awaited<ReturnType<typeof client.scanFile>>[] = [];
      for await (const result of client.scanMultiple(files)) {
        results.push(result);
      }

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('OK');
      expect(results[0].filename).toBe('file1.txt');
      expect(results[1].status).toBe('FOUND');
      expect(results[1].filename).toBe('file2.txt');
    });
  });

  describe('close', () => {
    it('should close the gRPC channel', async () => {
      await client.close();
      expect(mockClient.close).toHaveBeenCalled();
    });
  });

  describe('AbortSignal support', () => {
    it('should cancel call when signal is aborted', async () => {
      const mockCall = { cancel: vi.fn() };

      mockClient.scanFile.mockImplementation(
        (_req: unknown, _meta: unknown, _opts: unknown, _cb: Callback) => {
          return mockCall;
        },
      );

      const controller = new AbortController();

      // Start the scan but don't await it (cb is never called, so it hangs)
      void client.scanFile(Buffer.from('data'), 'test.txt', {
        signal: controller.signal,
      });

      // Give it a tick to start, then abort
      setTimeout(() => controller.abort(), 10);

      // Wait for the abort to propagate
      await new Promise((r) => setTimeout(r, 50));
      expect(mockCall.cancel).toHaveBeenCalled();
    });
  });
});
