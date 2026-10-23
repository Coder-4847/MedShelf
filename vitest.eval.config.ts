import { defineConfig } from 'vitest/config'

// Runs the real PP-OCR models (onnxruntime-web WASM in Node) against the synthetic fixtures.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/eval/**/*.eval.test.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    setupFiles: ['tests/unit/setup.ts'],
    fileParallelism: false,
  },
})
