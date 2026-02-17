import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClamAVGrpcClient } from '../../src/grpc/client.js';
import { ClamAVValidationError } from '../../src/errors.js';

const GRPC_URL = process.env.CLAMAV_GRPC_URL ?? 'localhost:9000';
const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

describe('gRPC Client Integration Tests', () => {
  let client: ClamAVGrpcClient;

  beforeAll(() => {
    client = new ClamAVGrpcClient({ url: GRPC_URL, timeout: 60_000 });
  });

  afterAll(async () => {
    await client.close();
  });

  describe('healthCheck', () => {
    it('should return healthy', async () => {
      const result = await client.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });

  describe('version', () => {
    it('should throw not-supported error', async () => {
      await expect(client.version()).rejects.toThrow(ClamAVValidationError);
      await expect(client.version()).rejects.toThrow('not supported over gRPC');
    });
  });

  describe('scanFile', () => {
    it('should scan a clean file', async () => {
      const cleanData = readFileSync(join(FIXTURES_DIR, 'clean.txt'));
      const result = await client.scanFile(cleanData, 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
      expect(result.scanTime).toBeGreaterThanOrEqual(0);
    });

    it('should detect EICAR test signature', async () => {
      const eicarData = readFileSync(join(FIXTURES_DIR, 'eicar.txt'));
      const result = await client.scanFile(eicarData, 'eicar.txt');

      expect(result.status).toBe('FOUND');
      expect(result.isInfected).toBe(true);
      expect(result.message).toMatch(/Eicar/i);
    });

    it('should scan a file from disk path', async () => {
      const filePath = join(FIXTURES_DIR, 'clean.txt');
      const result = await client.scanFile(filePath);

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
    });
  });

  describe('scanStream', () => {
    it('should stream scan a clean file', async () => {
      const cleanData = readFileSync(join(FIXTURES_DIR, 'clean.txt'));
      const result = await client.scanStream(cleanData, 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
    });

    it('should stream scan and detect EICAR', async () => {
      const eicarData = readFileSync(join(FIXTURES_DIR, 'eicar.txt'));
      const result = await client.scanStream(eicarData, 'eicar.txt');

      expect(result.status).toBe('FOUND');
      expect(result.isInfected).toBe(true);
      expect(result.message).toMatch(/Eicar/i);
    });

    it('should handle a large buffer by chunking', async () => {
      // 200KB of clean data -- should be chunked into multiple 64KB pieces
      const largeBuffer = Buffer.alloc(200 * 1024, 0x41);
      const result = await client.scanStream(largeBuffer, 'large-clean.bin');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
    });
  });

  describe('scanMultiple', () => {
    it('should scan multiple files via bidirectional streaming', async () => {
      const cleanData = readFileSync(join(FIXTURES_DIR, 'clean.txt'));
      const eicarData = readFileSync(join(FIXTURES_DIR, 'eicar.txt'));

      const files = [
        { data: cleanData, filename: 'clean.txt' },
        { data: eicarData, filename: 'eicar.txt' },
      ];

      const results: Awaited<ReturnType<typeof client.scanFile>>[] = [];
      for await (const result of client.scanMultiple(files)) {
        results.push(result);
      }

      expect(results).toHaveLength(2);

      // Results may arrive in any order
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual(['FOUND', 'OK']);

      const infected = results.find((r) => r.status === 'FOUND');
      expect(infected?.isInfected).toBe(true);
      expect(infected?.message).toMatch(/Eicar/i);
    });

    it('should scan multiple clean files', async () => {
      const cleanData = readFileSync(join(FIXTURES_DIR, 'clean.txt'));

      const files = [
        { data: Buffer.from('file one content'), filename: 'file1.txt' },
        { data: Buffer.from('file two content'), filename: 'file2.txt' },
        { data: cleanData, filename: 'clean.txt' },
      ];

      const results: Awaited<ReturnType<typeof client.scanFile>>[] = [];
      for await (const result of client.scanMultiple(files)) {
        results.push(result);
      }

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'OK')).toBe(true);
      expect(results.every((r) => !r.isInfected)).toBe(true);
    });
  });
});
