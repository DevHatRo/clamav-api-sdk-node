// Clients
export { ClamAV } from './client.js';
export { ClamAVRestClient } from './rest/client.js';
export { ClamAVGrpcClient } from './grpc/client.js';

// Errors
export {
  ClamAVError,
  ClamAVConnectionError,
  ClamAVTimeoutError,
  ClamAVValidationError,
  ClamAVServiceError,
} from './errors.js';

// Types
export type {
  ClamAVClientOptions,
  IClamAVClient,
  HealthCheckResult,
  VersionResult,
  ScanResult,
  FileEntry,
  RequestOptions,
  TlsOptions,
  GrpcOptions,
} from './types.js';
