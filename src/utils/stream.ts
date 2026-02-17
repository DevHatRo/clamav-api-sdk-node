import { Readable } from 'node:stream';

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB

/**
 * Async generator that yields Buffer chunks from a Readable stream.
 * Uses an array-based accumulator to avoid O(n^2) Buffer.concat on every data event.
 */
export async function* chunkStream(
  source: Readable,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): AsyncGenerator<Buffer> {
  const pending: Buffer[] = [];
  let pendingBytes = 0;

  for await (const data of source) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    pending.push(buf);
    pendingBytes += buf.length;

    while (pendingBytes >= chunkSize) {
      const merged = pending.length === 1 ? pending[0] : Buffer.concat(pending);
      pending.length = 0;

      yield merged.subarray(0, chunkSize);

      const remainder = merged.subarray(chunkSize);
      if (remainder.length > 0) {
        pending.push(remainder);
        pendingBytes = remainder.length;
      } else {
        pendingBytes = 0;
      }
    }
  }

  if (pendingBytes > 0) {
    yield pending.length === 1 ? pending[0] : Buffer.concat(pending);
  }
}

/**
 * Convert a Buffer into a Readable stream.
 */
export function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf);
}

/**
 * Collect all data from a Readable stream into a single Buffer.
 */
export async function streamToBuffer(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
