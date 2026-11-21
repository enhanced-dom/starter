import path from 'path'
import { jestConfigFactory } from '@enhanced-dom/jest'

export default {
  ...jestConfigFactory({
    ts: true,
    processorConfigPath: path.join(import.meta.dirname, 'tsconfig.json'),
    testEnvironment: 'node',
    transformersConfig: { useESM: true },
  }),
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1', // let Jest's resolver find the .ts source for extensioned relative imports (required under ESM)
  },
}
