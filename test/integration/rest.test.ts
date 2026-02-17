import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { ClamAVRestClient } from '../../src/rest/client.js';

const REST_URL = process.env.CLAMAV_REST_URL ?? 'http://localhost:8080';
const FIXTURES_DIR = join(import.meta.dirname, '../fixtures');

describe('REST Client Integration Tests', () => {
  let client: ClamAVRestClient;

  beforeAll(() => {
    client = new ClamAVRestClient({ url: REST_URL, timeout: 60_000 });
  });

  afterAll(async () => {
    await client.close();
  });

  describe('healthCheck', () => {
    it('should return healthy', async () => {
      const result = await client.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.message).toBe('ok');
    });
  });

  describe('version', () => {
    it('should return version info', async () => {
      const result = await client.version();
      expect(result.version).toBeDefined();
      expect(typeof result.version).toBe('string');
    });
  });

  describe('scanFile', () => {
    it('should scan a clean file from buffer', async () => {
      const cleanData = readFileSync(join(FIXTURES_DIR, 'clean.txt'));
      const result = await client.scanFile(cleanData, 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
      expect(result.scanTime).toBeGreaterThan(0);
      expect(result.filename).toBe('clean.txt');
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
      expect(result.filename).toBe('clean.txt');
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

    it('should stream scan from a Readable stream', async () => {
      const filePath = join(FIXTURES_DIR, 'clean.txt');
      const stream = createReadStream(filePath);
      const result = await client.scanStream(stream, 'clean.txt');

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
    });

    it('should stream scan from a file path', async () => {
      const filePath = join(FIXTURES_DIR, 'clean.txt');
      const result = await client.scanStream(filePath);

      expect(result.status).toBe('OK');
      expect(result.isInfected).toBe(false);
      expect(result.filename).toBe('clean.txt');
    });
  });

  describe('scanMultiple', () => {
    it('should scan multiple files and return results', async () => {
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

      const cleanResult = results.find((r) => r.filename === 'clean.txt');
      const eicarResult = results.find((r) => r.filename === 'eicar.txt');

      expect(cleanResult?.status).toBe('OK');
      expect(cleanResult?.isInfected).toBe(false);
      expect(eicarResult?.status).toBe('FOUND');
      expect(eicarResult?.isInfected).toBe(true);
    });
  });
});
