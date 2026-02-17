# @devhatro/clamav-api-sdk

A production-ready Node.js SDK for the [ClamAV API](https://github.com/DevHatRo/ClamAV-API) antivirus scanning service. Supports both REST and gRPC transports with a unified, idiomatic TypeScript interface.

## Features

- **Dual transport** -- REST (HTTP) and gRPC clients with a shared interface
- **TypeScript-first** -- Full type definitions with strict mode
- **Streaming support** -- Efficient large-file scanning via streams without buffering in memory
- **gRPC bidirectional streaming** -- Scan multiple files concurrently with `scanMultiple`
- **Cancellation** -- `AbortSignal` support on all methods
- **Error hierarchy** -- Typed error classes for connection, timeout, validation, and service errors
- **Dual module** -- Ships both ESM and CJS builds

## Installation

```bash
npm install @devhatro/clamav-api-sdk
# or
pnpm add @devhatro/clamav-api-sdk
# or
yarn add @devhatro/clamav-api-sdk
```

## Quick Start

### REST Client (default)

```typescript
import { ClamAV } from '@devhatro/clamav-api-sdk';

const client = new ClamAV({ url: 'http://localhost:6000' });

// Health check
const health = await client.healthCheck();
console.log(health.healthy); // true

// Scan a file from disk
const result = await client.scanFile('/path/to/file.pdf');
console.log(result.isInfected); // false
console.log(result.status);     // "OK"

// Scan a buffer
const buffer = Buffer.from('file contents');
const result2 = await client.scanFile(buffer, 'test.txt');

// Stream scan (ideal for large files)
import { createReadStream } from 'fs';
const stream = createReadStream('/path/to/large-file.iso');
const result3 = await client.scanStream(stream, 'large-file.iso');

await client.close();
```

### gRPC Client

```typescript
import { ClamAVGrpcClient } from '@devhatro/clamav-api-sdk';

const client = new ClamAVGrpcClient({ url: 'localhost:9000' });

// Scan a file
const result = await client.scanFile(buffer, 'test.txt');

// Stream scan with automatic chunking
const result2 = await client.scanStream(largeBuffer, 'large.bin');

// Scan multiple files with bidirectional streaming
const files = [
  { data: Buffer.from('file1'), filename: 'file1.txt' },
  { data: Buffer.from('file2'), filename: 'file2.txt' },
];

for await (const result of client.scanMultiple(files)) {
  console.log(`${result.filename}: ${result.status}`);
}

await client.close();
```

### Using the REST Client Directly

```typescript
import { ClamAVRestClient } from '@devhatro/clamav-api-sdk';

const client = new ClamAVRestClient({
  url: 'http://localhost:6000',
  timeout: 60_000,
  headers: { 'Authorization': 'Bearer token' },
});

// Get API version (REST only)
const version = await client.version();
console.log(version.version); // "1.4.0"
```

## API Reference

### Client Options

```typescript
interface ClamAVClientOptions {
  /** Base URL for REST or host:port for gRPC. Required. */
  url: string;

  /** Request timeout in milliseconds. Default: 300000 (5 min). */
  timeout?: number;

  /** Custom HTTP headers (REST only). */
  headers?: Record<string, string>;

  /** Explicit transport selection: 'rest' or 'grpc'. Auto-detected from URL if omitted. */
  transport?: 'rest' | 'grpc';

  /** TLS/SSL options. */
  tls?: {
    ca?: string | Buffer;
    cert?: string | Buffer;
    key?: string | Buffer;
    rejectUnauthorized?: boolean;
  };

  /** gRPC-specific options. */
  grpc?: {
    maxSendMessageSize?: number;    // Default: 200MB
    maxReceiveMessageSize?: number; // Default: 200MB
  };
}
```

### Methods

All clients implement the `IClamAVClient` interface:

| Method | Description |
|--------|-------------|
| `healthCheck(options?)` | Check if the ClamAV service is healthy |
| `version(options?)` | Get API version info (REST only; gRPC throws) |
| `scanFile(input, filename?, options?)` | Scan a file (Buffer or file path) |
| `scanStream(input, filename?, options?)` | Scan via streaming (Readable, Buffer, or path) |
| `scanMultiple(files, options?)` | Scan multiple files (gRPC: bidi streaming; REST: parallel) |
| `close()` | Close the client and release resources |

### Response Types

```typescript
interface ScanResult {
  status: 'OK' | 'FOUND' | 'ERROR';
  message: string;       // Virus name if infected
  scanTime: number;      // Duration in seconds
  filename?: string;
  isInfected: boolean;   // Convenience: true if status === 'FOUND'
}

interface HealthCheckResult {
  healthy: boolean;
  message: string;
}

interface VersionResult {
  version: string;
  commit: string;
  build: string;
}
```

### Error Handling

The SDK provides typed error classes for different failure modes:

```typescript
import {
  ClamAV,
  ClamAVError,
  ClamAVConnectionError,
  ClamAVTimeoutError,
  ClamAVValidationError,
  ClamAVServiceError,
} from '@devhatro/clamav-api-sdk';

try {
  const result = await client.scanFile(buffer);
} catch (error) {
  if (error instanceof ClamAVTimeoutError) {
    console.error('Scan timed out');
  } else if (error instanceof ClamAVServiceError) {
    console.error('ClamAV daemon is down');
  } else if (error instanceof ClamAVValidationError) {
    console.error('Invalid input:', error.message);
  } else if (error instanceof ClamAVConnectionError) {
    console.error('Cannot reach server');
  }
}
```

| Error Class | Code | When |
|------------|------|------|
| `ClamAVConnectionError` | `CONNECTION_ERROR` | Server unreachable |
| `ClamAVTimeoutError` | `TIMEOUT` | Scan exceeded timeout |
| `ClamAVValidationError` | `VALIDATION_ERROR` | Bad input (file too large, missing data) |
| `ClamAVServiceError` | `SERVICE_ERROR` | ClamAV daemon unavailable |
| `ClamAVError` | varies | Base class for all SDK errors |

### Request Cancellation

All methods accept an `AbortSignal` for cancellation:

```typescript
const controller = new AbortController();

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10_000);

const result = await client.scanFile(buffer, 'file.pdf', {
  signal: controller.signal,
});
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm
- Docker (for integration tests)

### Setup

```bash
pnpm install
```

### Scripts

```bash
pnpm build          # Build ESM + CJS + type declarations
pnpm typecheck      # TypeScript type checking
pnpm lint           # ESLint + Prettier check
pnpm lint:fix       # Auto-fix lint issues

pnpm test:unit      # Run unit tests
pnpm test:coverage  # Unit tests with coverage
pnpm test:integration  # Integration tests (requires running ClamAV API)
```

### Running Integration Tests

Integration tests require a running ClamAV API instance. Use the provided Docker Compose file:

```bash
# Start ClamAV API (takes ~90s for virus definitions to load)
docker compose -f docker-compose.test.yml up -d

# Wait for health check to pass
curl http://localhost:8080/api/health-check

# Run integration tests
pnpm test:integration

# Tear down
docker compose -f docker-compose.test.yml down -v
```

The Docker Compose file uses the official image: `ghcr.io/devhatro/clamav-api:latest`

### Releasing

This project uses [release-please](https://github.com/googleapis/release-please) for automated versioning and releases. The workflow is:

1. Merge PRs to `main` using [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `chore:`).
2. release-please automatically opens/updates a "Release PR" that bumps the version in `package.json` and updates `CHANGELOG.md`.
3. When the Release PR is merged, a GitHub Release is created and the package is automatically published to npm.

**Required setup:**
- Add an `NPM_TOKEN` secret to the repository (Settings > Secrets > Actions) with an npm automation token that has publish access to the `@devhat` scope.

## License

Apache-2.0 -- see [LICENSE](LICENSE) for details.
