import fs from 'fs'
import os from 'os'
import path from 'path'
import { jest } from '@jest/globals'

import { Feature, ProjectType, TestRunner, generate, write, type IOptions } from '../src/generator.js'

const LICENSE_PATH = path.resolve(import.meta.dirname, '../LICENSE.md')
const MOCK_VERSION = '9.9.9'

const BASE_OPTIONS: IOptions = {
  folder: 'out',
  name: 'my-widget',
  description: 'My widget',
  type: ProjectType.ISOMORPHIC,
  features: [],
}

const generateWith = async (overrides: Partial<IOptions> = {}) => {
  const files = await generate({ ...BASE_OPTIONS, ...overrides }, LICENSE_PATH)
  const packageJson = JSON.parse(files.get('package.json') ?? '{}')
  return { files, packageJson }
}

const mockRegistry = (implementation: () => Promise<Response>) => jest.spyOn(global, 'fetch').mockImplementation(implementation)

beforeEach(() => {
  mockRegistry(async () => new Response(JSON.stringify({ version: MOCK_VERSION })))
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('base project', () => {
  test('GENERATOR-1: writes only the always-on files when no optional flags are set', async () => {
    const { files } = await generateWith()
    expect([...files.keys()].sort()).toEqual(
      [
        '.gitignore',
        'LICENSE.md',
        'README.md',
        'eslint.config.mjs',
        'lint-staged.config.mjs',
        'package.json',
        'prettier.config.mjs',
        'src/index.ts',
      ].sort(),
    )
    expect(files.get('src/index.ts')).toBe('export {}\n')
  })

  test('GENERATOR-1b: .gitignore matches the convention other packages seed before configure-lint appends to it', async () => {
    const { files } = await generateWith()
    expect(files.get('.gitignore')).toBe(
      `dist/
node_modules/
.vscode/
.DS_Store
npm-debug.log*
.claude/*
.devcontainer/*
.rtk/*
CLAUDE.md
`,
    )
  })

  test('GENERATOR-2: scopes an unscoped name and derives the repository from it', async () => {
    const { packageJson } = await generateWith()
    expect(packageJson.name).toBe('@enhanced-dom/my-widget')
    expect(packageJson.repository).toBe('https://github.com/enhanced-dom/my-widget.git')
  })

  test('GENERATOR-3: keeps an already scoped name as-is', async () => {
    const { packageJson } = await generateWith({ name: '@other/thing' })
    expect(packageJson.name).toBe('@other/thing')
    expect(packageJson.repository).toBe('https://github.com/enhanced-dom/thing.git')
  })

  test('GENERATOR-4: README leads with the description, and has no leading blank lines without one', async () => {
    const withDescription = await generateWith()
    const withoutDescription = await generateWith({ description: '' })
    expect(withDescription.files.get('README.md')).toMatch(/^My widget\n\n## Getting started/)
    expect(withoutDescription.files.get('README.md')).toMatch(/^## Getting started/)
  })

  test('GENERATOR-5: LICENSE.md is a byte-for-byte copy of the source license', async () => {
    const { files } = await generateWith()
    expect(files.get('LICENSE.md')).toBe(fs.readFileSync(LICENSE_PATH, 'utf-8'))
  })

  test.each(Object.values(ProjectType))('GENERATOR-6: forwards -type=%s into configure-build', async (type) => {
    const { packageJson } = await generateWith({ type })
    expect(packageJson.scripts['configure-build']).toBe(`@enhanced-dom-bootstrap-tsconfig --type=${type}`)
  })

  test.each([
    [ProjectType.NODE, undefined, true],
    [ProjectType.ISOMORPHIC, undefined, true],
    [ProjectType.BROWSER, undefined, false],
    [ProjectType.BROWSER, TestRunner.JEST, true],
  ])('GENERATOR-7: @types/node presence for type=%s tests=%s is %s', async (type, tests, expected) => {
    const { packageJson } = await generateWith({ type, tests })
    expect('@types/node' in packageJson.devDependencies).toBe(expected)
  })

  test('GENERATOR-8: eslint gets the node env only for node projects', async () => {
    const node = await generateWith({ type: ProjectType.NODE })
    const browser = await generateWith({ type: ProjectType.BROWSER })
    expect(node.files.get('eslint.config.mjs')).toContain("env: ['node']")
    expect(browser.files.get('eslint.config.mjs')).not.toContain('env:')
  })
})

describe('feature flags', () => {
  test('GENERATOR-9: -css adds style configs, placeholder stylesheet, scripts and the webpack toolchain', async () => {
    const { files, packageJson } = await generateWith({ features: [Feature.CSS] })
    expect(files.has('stylelint.config.mjs')).toBe(true)
    expect(files.has('typed-styles.config.mjs')).toBe(true)
    expect(files.has('src/index.pcss')).toBe(true)
    expect(packageJson.scripts.build).toBe('tsc -p ./tsconfig.json && webpack --config typed-styles.config.mjs')
    expect(packageJson.scripts.lint).toContain('stylelint --fix --config stylelint.config.mjs src/**/*.pcss')
    expect(packageJson.scripts.css).toBeDefined()
    expect(Object.keys(packageJson.devDependencies)).toEqual(expect.arrayContaining(['@enhanced-dom/babel', '@enhanced-dom/webpack']))
  })

  test('GENERATOR-10: -react swaps the entry to .tsx and relies on @enhanced-dom/react for react itself', async () => {
    const { files, packageJson } = await generateWith({ features: [Feature.REACT] })
    expect(files.has('src/index.ts')).toBe(false)
    expect(files.get('src/index.tsx')).toContain("import React from 'react'")
    expect(packageJson.scripts['configure-build']).toMatch(/ --react$/)
    expect(Object.keys(packageJson.dependencies)).toEqual(['@enhanced-dom/react'])
  })

  test('GENERATOR-11: -webcomponent alone generates a custom element named after the package', async () => {
    const { files, packageJson } = await generateWith({ name: 'fancy-box', features: [Feature.WEBCOMPONENT] })
    const entry = files.get('src/index.ts')
    expect(entry).toContain('export class FancyBoxWebComponent extends HTMLElement')
    expect(entry).toContain("static tag = 'enhanced-dom-fancy-box'")
    expect(packageJson.dependencies).toHaveProperty('@enhanced-dom/webcomponent')
  })

  test("GENERATOR-12: -react with -webcomponent keeps react's entry but still adds the webcomponent dependency", async () => {
    const { files, packageJson } = await generateWith({ features: [Feature.WEBCOMPONENT, Feature.REACT] })
    expect(files.has('src/index.ts')).toBe(false)
    expect(files.get('src/index.tsx')).not.toContain('HTMLElement')
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(['@enhanced-dom/react', '@enhanced-dom/webcomponent'])
  })

  test('GENERATOR-13: -tests jest adds jest config, test tsconfig and script', async () => {
    const { files, packageJson } = await generateWith({ tests: TestRunner.JEST })
    expect(files.has('test/jest.config.mjs')).toBe(true)
    expect(packageJson.scripts.test).toBe('jest --config test/jest.config.mjs --runInBand')
    expect(packageJson.scripts['configure-lint']).toMatch(/^@enhanced-dom-fallow --gitignore --entry 'test\/\*\*\/\*\.test\.ts' && /)
    expect(packageJson.devDependencies).toHaveProperty('@enhanced-dom/jest')
    const testTsconfig = JSON.parse(files.get('test/tsconfig.json') ?? '{}')
    expect(testTsconfig.compilerOptions.types).toEqual(['node', 'jest'])
    expect(testTsconfig.compilerOptions).not.toHaveProperty('jsx')
    expect(testTsconfig.include).toEqual(['./**/*.ts', '../src/**/*.ts'])
  })

  test.each([
    ['plain', [Feature.DEMO, Feature.CSS], [{ test: '/\\.pcss$/', raw: true }]],
    ['webcomponent', [Feature.DEMO, Feature.CSS, Feature.WEBCOMPONENT], [{ test: '/\\.pcss$/', raw: true }]],
    ['react', [Feature.DEMO, Feature.CSS, Feature.REACT], [{ test: '/\\.pcss$/', raw: false }]],
    [
      'react+webcomponent',
      [Feature.DEMO, Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT],
      [
        { test: '/\\.webcomponent\\.pcss$/', raw: true },
        { test: '/(?<!\\.webcomponent)\\.pcss$/', raw: false },
      ],
    ],
  ])('GENERATOR-23: %s demo styles are inlined raw for webcomponents and extracted for react', async (_, features, expectedRules) => {
    const { files } = await generateWith({ features })
    const config = files.get('demo/webpack.config.mjs') ?? ''
    const rules = [...config.matchAll(/test: (\/.*pcss\$\/),[\s\S]*?raw: (true|false),\s*extract: (true|false)/g)].map(
      ([, test, raw, extract]) => ({ test, raw: raw === 'true', extract: extract === 'true' }),
    )
    expect(rules).toEqual(expectedRules.map(({ test, raw }) => ({ test, raw, extract: !raw })))
  })

  test.each([
    ['plain', [Feature.CSS], ["{ raw: true, filePaths: globSync('./src/**/*.pcss') }"]],
    ['react', [Feature.CSS, Feature.REACT], ["{ raw: false, filePaths: globSync('./src/**/*.pcss') }"]],
    [
      'react+webcomponent',
      [Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT],
      [
        "{ raw: true, filePaths: globSync('./src/**/*.webcomponent.pcss') }",
        "{ raw: false, filePaths: globSync('./src/**/*.pcss').filter((filePath) => !filePath.endsWith('.webcomponent.pcss')) }",
      ],
    ],
  ])('GENERATOR-24: %s typed-styles config splits files into the same raw/extracted groups', async (_, features, expectedGroups) => {
    const { files } = await generateWith({ features })
    const config = files.get('typed-styles.config.mjs') ?? ''
    expect(config).toContain(`const styleGroups = [\n${expectedGroups.map((group) => `  ${group},`).join('\n')}\n]`)
  })

  test.each([
    ['css', [Feature.CSS]],
    ['css+webcomponent', [Feature.CSS, Feature.WEBCOMPONENT]],
    ['react without css', [Feature.REACT]],
  ])('GENERATOR-26: %s projects get no extracted styles build', async (_, features) => {
    const { files, packageJson } = await generateWith({ features })
    expect(files.has('styles.config.mjs')).toBe(false)
    expect(packageJson.scripts.build).not.toContain('--config styles.config.mjs')
  })

  test.each([
    ['react', [Feature.CSS, Feature.REACT], "globSync('./src/**/*.pcss')\n"],
    [
      'react+webcomponent',
      [Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT],
      "globSync('./src/**/*.pcss').filter((filePath) => !filePath.endsWith('.webcomponent.pcss'))\n",
    ],
  ])(
    'GENERATOR-27: %s projects build only the extracted stylesheets into dist after typed-styles',
    async (_, features, expectedFilePaths) => {
      const { files, packageJson } = await generateWith({ features })
      expect(files.get('styles.config.mjs')).toContain(`const filePaths = ${expectedFilePaths}`)
      expect(packageJson.scripts.build).toBe(
        'tsc -p ./tsconfig.json && webpack --config typed-styles.config.mjs && webpack --config styles.config.mjs',
      )
    },
  )

  test('GENERATOR-25: -tests jest keeps the browser globals for non-node projects', async () => {
    const { files } = await generateWith({ type: ProjectType.BROWSER, tests: TestRunner.JEST })
    expect(files.get('eslint.config.mjs')).toContain("env: ['browser', 'jest']")
  })

  test('GENERATOR-22: -tests jest lints the test folder with jest globals, alongside the node env and stylelint', async () => {
    const { files, packageJson } = await generateWith({ type: ProjectType.NODE, tests: TestRunner.JEST, features: [Feature.CSS] })
    expect(files.get('eslint.config.mjs')).toContain("env: ['node', 'jest']")
    expect(packageJson.scripts.lint).toBe(
      'eslint src/** test/** --fix --config eslint.config.mjs && stylelint --fix --config stylelint.config.mjs src/**/*.pcss',
    )
  })

  test('GENERATOR-14: the test tsconfig also includes .tsx files for react projects', async () => {
    const { files } = await generateWith({ tests: TestRunner.JEST, features: [Feature.REACT] })
    const testTsconfig = JSON.parse(files.get('test/tsconfig.json') ?? '{}')
    expect(testTsconfig.include).toEqual(['./**/*.ts', './**/*.tsx', '../src/**/*.ts', '../src/**/*.tsx'])
  })

  test('GENERATOR-15: -demo without -css pulls in the webpack toolchain but no stylesheet rule', async () => {
    const { files, packageJson } = await generateWith({ features: [Feature.DEMO] })
    const config = files.get('demo/webpack.config.mjs')
    expect(config).not.toContain('pcss')
    expect(config).toContain("'../src/index.ts'")
    expect(packageJson.scripts.demo).toBeDefined()
    expect(packageJson.scripts.docs).toBeDefined()
    expect(Object.keys(packageJson.devDependencies)).toEqual(expect.arrayContaining(['@enhanced-dom/babel', '@enhanced-dom/webpack']))
    expect(files.has('stylelint.config.mjs')).toBe(false)
  })

  test('GENERATOR-16: -demo with -css and -react includes the stylesheet rule and bundles the .tsx entry', async () => {
    const { files } = await generateWith({ features: [Feature.DEMO, Feature.CSS, Feature.REACT] })
    const config = files.get('demo/webpack.config.mjs')
    expect(config).toContain('test: /\\.pcss$/')
    expect(config).toContain("'../src/index.tsx'")
  })

  test('GENERATOR-28: -standalone bundles the build output with @vercel/ncc instead of npm pack', async () => {
    const { packageJson } = await generateWith({ features: [Feature.STANDALONE] })
    expect(packageJson.scripts.package).toBe('ncc build ./dist/index.js -o ./dist')
    expect(packageJson.scripts.build).toBe('tsc -p ./tsconfig.json')
    expect(packageJson.devDependencies).toHaveProperty('@vercel/ncc')
  })

  test('GENERATOR-29: -standalone with -react bundles the .tsx entry’s compiled basename', async () => {
    const { packageJson } = await generateWith({ features: [Feature.STANDALONE, Feature.REACT] })
    expect(packageJson.scripts.package).toBe('ncc build ./dist/index.js -o ./dist')
  })
})

describe('dependency versions', () => {
  test('GENERATOR-17: pins every @enhanced-dom dependency to the latest registry version', async () => {
    const { packageJson } = await generateWith({ tests: TestRunner.JEST, features: Object.values(Feature) })
    const scoped = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const scopedVersions = Object.entries(scoped).filter(([name]) => name.startsWith('@enhanced-dom/'))
    expect(scopedVersions.length).toBeGreaterThan(0)
    scopedVersions.forEach(([, version]) => expect(version).toBe(`^${MOCK_VERSION}`))
    expect(packageJson.devDependencies['@types/node']).toBe('^22.20.5')
  })

  test('GENERATOR-18: leaves "latest" when the registry is unreachable', async () => {
    mockRegistry(async () => {
      throw new Error('offline')
    })
    const { packageJson } = await generateWith()
    expect(packageJson.devDependencies['@enhanced-dom/build']).toBe('latest')
  })

  test('GENERATOR-19: leaves "latest" when the registry answers with an error status', async () => {
    mockRegistry(async () => new Response('not found', { status: 404 }))
    const { packageJson } = await generateWith()
    expect(packageJson.devDependencies['@enhanced-dom/build']).toBe('latest')
  })
})

describe('writing files', () => {
  let folder: string

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-write-'))
  })

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  })

  test('GENERATOR-20: creates nested folders for new files', () => {
    write(new Map([['nested/deep/file.txt', 'content']]), { ...BASE_OPTIONS, folder })
    expect(fs.readFileSync(path.join(folder, 'nested/deep/file.txt'), 'utf-8')).toBe('content')
  })

  test('GENERATOR-21: overwrites existing files', () => {
    const filePath = path.join(folder, 'file.txt')
    fs.writeFileSync(filePath, 'original')
    write(new Map([['file.txt', 'new']]), { ...BASE_OPTIONS, folder })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
  })
})
