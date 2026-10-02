import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // tsup injects baseUrl into the dts build, which TS 6 deprecates
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  splitting: false,
  sourcemap: true,
  outDir: 'dist',
  target: 'node18',
  external: ['@grpc/grpc-js', '@grpc/proto-loader'],
});
