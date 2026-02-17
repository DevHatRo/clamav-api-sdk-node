import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClamAVRestClient } from '../../src/rest/client.js';
import {
  ClamAVConnectionError,
  ClamAVError,
  ClamAVServiceError,
  ClamAVTimeoutError,
  ClamAVValidationError,
} from '../../src/errors.js';
import { Readable } from 'node:stream';

function mockFetchResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ClamAVRestClient', () => {
  let client: ClamAVRestClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new ClamAVRestClient({ url: 'http://localhost:6000' });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('healthCheck', () => {
    it('should return healthy when service responds ok', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: 'ok' }));

      const result = await client.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:6000/api/health-check',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return unhealthy on 502', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ message: 'Clamd service unavailable' }, 502),
      );

      const result = await client.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe('Clamd service unavailable');
    });

    it('should throw ClamAVConnectionError on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.healthCheck()).rejects.toThrow(ClamAVConnectionError);
    });
  });

  describe('version', () => {
    it('should return version info', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          version: '1.3.0',
          commit: 'abc1234',
          build: '2025-10-16T12:00:00Z',
        }),
      );

      const result = await client.version();

      expect(result.version).toBe('1.3.0');
      expect(result.commit).toBe('abc1234');
      expect(result.build).toBe('2025-10-16T12:00:00Z');
    });

    it('should throw on non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}, 500));

      await expect(client.version()).rejects.toThrow(ClamAVError);
    });
  });

  describe('scanFile', () => {
    it('should scan a clean file', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.001 }));

      const result = await client.scanFile(Buffer.from('clean content'), 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
      expect(result.message).toBe('');
      expect(result.scanTime).toBe(0.001);
      expect(result.filename).toBe('clean.txt');
    });

    it('should detect an infected file', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ status: 'FOUND', message: 'Eicar-Test-Signature', time: 0.002 }),
      );

      const result = await client.scanFile(Buffer.from('eicar'), 'eicar.txt');

      expect(result.status).toBe('FOUND');
      expect(result.isInfected).toBe(true);
      expect(result.message).toBe('Eicar-Test-Signature');
    });

    it('should throw ClamAVValidationError on 400', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: 'Provide a single file' }, 400));

      await expect(client.scanFile(Buffer.from(''), 'empty.txt')).rejects.toThrow(
        ClamAVValidationError,
      );
    });

    it('should throw ClamAVValidationError on 413', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ message: 'File too large. Maximum size is 200 bytes' }, 413),
      );

      await expect(client.scanFile(Buffer.from('big'), 'big.txt')).rejects.toThrow(
        ClamAVValidationError,
      );
    });

    it('should throw ClamAVServiceError on 502', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          { status: 'Clamd service down', message: 'Scanning service unavailable' },
          502,
        ),
      );

      await expect(client.scanFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        ClamAVServiceError,
      );
    });

    it('should throw ClamAVTimeoutError on 504', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          { status: 'Scan timeout', message: 'scan operation timed out after 300 seconds' },
          504,
        ),
      );

      await expect(client.scanFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(
        ClamAVTimeoutError,
      );
    });

    it('should throw on cancelled request (499)', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse(
          { status: 'Client closed request', message: 'request canceled by client' },
          499,
        ),
      );

      await expect(client.scanFile(Buffer.from('test'), 'test.txt')).rejects.toThrow(ClamAVError);
    });

    it('should use multipart form-data', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.001 }));

      await client.scanFile(Buffer.from('content'), 'test.txt');

      const call = fetchSpy.mock.calls[0];
      const init = call[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
    });
  });

  describe('scanStream', () => {
    it('should scan a buffer via stream endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.002 }));

      const result = await client.scanStream(Buffer.from('data'), 'file.bin');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('http://localhost:6000/api/stream-scan');
      const init = call[1] as RequestInit;
      expect(init.method).toBe('POST');
    });

    it('should scan a Readable stream', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.003 }));

      const stream = Readable.from(Buffer.from('stream data'));
      const result = await client.scanStream(stream, 'stream.txt');

      expect(result.status).toBe('OK');
    });

    it('should detect infected file via stream', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ status: 'FOUND', message: 'Eicar-Test-Signature', time: 0.001 }),
      );

      const result = await client.scanStream(Buffer.from('eicar'), 'eicar.txt');

      expect(result.status).toBe('FOUND');
      expect(result.isInfected).toBe(true);
    });

    it('should set Content-Type and Content-Length headers', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.001 }));

      const data = Buffer.from('test data');
      await client.scanStream(data, 'file.bin');

      const call = fetchSpy.mock.calls[0];
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/octet-stream');
      expect(headers['Content-Length']).toBe(String(data.length));
    });
  });

  describe('scanMultiple', () => {
    it('should scan multiple files and yield results', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 'OK', message: '', time: 0.001 }));
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ status: 'FOUND', message: 'Eicar-Test-Signature', time: 0.002 }),
      );

      const files = [
        { data: Buffer.from('clean'), filename: 'clean.txt' },
        { data: Buffer.from('eicar'), filename: 'eicar.txt' },
      ];

      const results: Awaited<ReturnType<typeof client.scanFile>>[] = [];
      for await (const result of client.scanMultiple(files)) {
        results.push(result);
      }

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('OK');
      expect(results[1].status).toBe('FOUND');
    });

    it('should yield ERROR result for failed scans', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

      const files = [{ data: Buffer.from('test'), filename: 'test.txt' }];

      const results: Awaited<ReturnType<typeof client.scanFile>>[] = [];
      for await (const result of client.scanMultiple(files)) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('ERROR');
    });
  });

  describe('close', () => {
    it('should resolve without errors', async () => {
      await expect(client.close()).resolves.toBeUndefined();
    });
  });

  describe('AbortSignal support', () => {
    it('should cancel request when signal is aborted', async () => {
      const controller = new AbortController();

      fetchSpy.mockImplementation((_url, init) => {
        const signal = (init as RequestInit).signal;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          const onAbort = () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      });

      // Abort immediately after starting
      queueMicrotask(() => controller.abort());

      await expect(
        client.scanFile(Buffer.from('data'), 'test.txt', {
          signal: controller.signal,
        }),
      ).rejects.toThrow(ClamAVError);
    });

    it('should handle already-aborted signal', async () => {
      fetchSpy.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            if (signal?.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      );

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.scanFile(Buffer.from('data'), 'test.txt', { signal: controller.signal }),
      ).rejects.toThrow(ClamAVError);
    });
  });

  describe('timeout', () => {
    it('should timeout after configured duration', async () => {
      const timeoutClient = new ClamAVRestClient({ url: 'http://localhost:6000', timeout: 50 });

      fetchSpy.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      );

      await expect(timeoutClient.scanFile(Buffer.from('data'), 'test.txt')).rejects.toThrow(
        ClamAVTimeoutError,
      );
    });
  });

  describe('custom headers', () => {
    it('should include custom headers in requests', async () => {
      const customClient = new ClamAVRestClient({
        url: 'http://localhost:6000',
        headers: { 'X-Custom': 'value' },
      });

      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: 'ok' }));

      await customClient.healthCheck();

      const call = fetchSpy.mock.calls[0];
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value');
    });
  });

  describe('URL handling', () => {
    it('should strip trailing slashes from base URL', async () => {
      const clientWithSlash = new ClamAVRestClient({ url: 'http://localhost:6000/' });

      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: 'ok' }));

      await clientWithSlash.healthCheck();

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('http://localhost:6000/api/health-check');
    });
  });
});
