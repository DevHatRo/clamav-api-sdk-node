import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Resolved input: the data source and an optional filename.
 */
export interface ResolvedInput {
  /** A Readable stream for the file content. */
  stream: Readable;
  /** A Buffer if the input was already a Buffer. */
  buffer?: Buffer;
  /** The resolved filename. */
  filename: string;
  /** The size in bytes, if known. */
  size?: number;
}

/**
 * Resolve an input (file path, Buffer, or Readable) into a normalized form.
 * If a string path is provided, verifies the file exists and creates a read stream.
 */
export async function resolveInput(
  input: Buffer | string | Readable,
  filename?: string,
): Promise<ResolvedInput> {
  if (typeof input === 'string') {
    const fileStat = await stat(input);
    const stream = createReadStream(input);
    return {
      stream,
      filename: filename ?? basename(input),
      size: fileStat.size,
    };
  }

  if (Buffer.isBuffer(input)) {
    const { Readable } = await import('node:stream');
    const stream = Readable.from(input);
    return {
      stream,
      buffer: input,
      filename: filename ?? 'file',
      size: input.length,
    };
  }

  // Readable stream
  return {
    stream: input,
    filename: filename ?? 'file',
  };
}

/**
 * Derive a filename from the given filename or input.
 * If input is a file path (string) and no explicit filename, uses the basename.
 */
export function deriveFilename(input: Buffer | string | Readable, filename?: string): string {
  if (filename) return filename;
  if (typeof input === 'string') return basename(input);
  return 'file';
}
