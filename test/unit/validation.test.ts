import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveInput, deriveFilename } from '../../src/utils/validation.js';

describe('resolveInput', () => {
  it('should resolve a Buffer input', async () => {
    const buffer = Buffer.from('hello world');
    const result = await resolveInput(buffer, 'test.txt');

    expect(result.buffer).toBe(buffer);
    expect(result.filename).toBe('test.txt');
    expect(result.size).toBe(11);
    expect(result.stream).toBeDefined();
  });

  it('should use default filename for Buffer when none provided', async () => {
    const buffer = Buffer.from('data');
    const result = await resolveInput(buffer);

    expect(result.filename).toBe('file');
  });

  it('should resolve a file path', async () => {
    const tmpFile = join(tmpdir(), 'clamav-sdk-test-resolve.txt');
    writeFileSync(tmpFile, 'test content');

    try {
      const result = await resolveInput(tmpFile);

      expect(result.filename).toBe('clamav-sdk-test-resolve.txt');
      expect(result.size).toBe(12);
      expect(result.stream).toBeDefined();
      expect(result.buffer).toBeUndefined();

      // Consume and destroy the stream before cleanup
      result.stream.destroy();
      await new Promise((r) => result.stream.on('close', r));
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('should use explicit filename over file path basename', async () => {
    const tmpFile = join(tmpdir(), 'clamav-sdk-test-resolve2.txt');
    writeFileSync(tmpFile, 'test');

    try {
      const result = await resolveInput(tmpFile, 'custom.txt');
      expect(result.filename).toBe('custom.txt');

      result.stream.destroy();
      await new Promise((r) => result.stream.on('close', r));
    } finally {
      unlinkSync(tmpFile);
    }
  });

  it('should throw for nonexistent file path', async () => {
    await expect(resolveInput('/nonexistent/path/file.txt')).rejects.toThrow();
  });

  it('should resolve a Readable stream', async () => {
    const stream = Readable.from(Buffer.from('stream data'));
    const result = await resolveInput(stream, 'stream.txt');

    expect(result.stream).toBe(stream);
    expect(result.filename).toBe('stream.txt');
    expect(result.size).toBeUndefined();
    expect(result.buffer).toBeUndefined();
  });

  it('should use default filename for Readable stream when none provided', async () => {
    const stream = Readable.from(Buffer.from('data'));
    const result = await resolveInput(stream);

    expect(result.filename).toBe('file');
  });
});

describe('deriveFilename', () => {
  it('should return explicit filename when provided', () => {
    expect(deriveFilename(Buffer.from('test'), 'custom.txt')).toBe('custom.txt');
  });

  it('should derive filename from file path', () => {
    expect(deriveFilename('/path/to/document.pdf')).toBe('document.pdf');
  });

  it('should return default for Buffer without explicit filename', () => {
    expect(deriveFilename(Buffer.from('test'))).toBe('file');
  });

  it('should return default for Readable without explicit filename', () => {
    const stream = Readable.from(Buffer.from('test'));
    expect(deriveFilename(stream)).toBe('file');
  });
});
