import path from 'path'
import fs from 'fs'

export enum ProjectType {
  NODE = 'node',
  BROWSER = 'browser',
  ISOMORPHIC = 'isomorphic',
}

export enum TestRunner {
  JEST = 'jest',
}

export enum Feature {
  CSS = 'css',
  REACT = 'react',
  WEBCOMPONENT = 'webcomponent',
  DEMO = 'demo',
  STANDALONE = 'standalone',
}

export interface IOptions {
  folder: string
  name: string
  description: string
  type: ProjectType
  tests?: TestRunner
  features: Feature[]
}

interface IPackageJson {
  name: string
  version: string
  description: string
  repository: string
  type: string
  main: string
  scripts: Record<string, string>
  keywords: string[]
  author: string
  license: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  engines: Record<string, string>
}

interface IProject {
  packageJson: IPackageJson
  files: Map<string, string>
  entryFile: string
  eslintEnv: string[]
}

export const SCOPE = '@enhanced-dom'
const LATEST = 'latest'
const AUTHOR =
  'CD9B4A105290E17E0948E021DF4105107C88693C59C0B891CCC08366C51AEA990902A6A156AC87D88A2FC41422A5E1C3C4071F251F19441C4516000EC25F87DF'

const configFile = (factory: string, args = '') => `import { ${factory} } from '@enhanced-dom/lint'\n\nexport default ${factory}(${args})\n`

// configure-lint appends its own .fallowrc.json/.npmrc/.nvmrc block to this at prepare time
const GITIGNORE = `dist/
node_modules/
.vscode/
.DS_Store
npm-debug.log*
.claude/*
.devcontainer/*
.rtk/*
CLAUDE.md
`

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

interface IStyleGroup {
  raw: boolean
  webpackTest: string
  filePathsExpression: string
}

// webcomponents inline their styles into the shadow DOM (raw); react styles are extracted into a stylesheet
const getStyleGroups = (options: IOptions): IStyleGroup[] => {
  const allStyles = { webpackTest: '/\\.pcss$/', filePathsExpression: "globSync('./src/**/*.pcss')" }
  if (!options.features.includes(Feature.REACT)) {
    return [{ raw: true, ...allStyles }]
  }
  if (!options.features.includes(Feature.WEBCOMPONENT)) {
    return [{ raw: false, ...allStyles }]
  }
  return [
    { raw: true, webpackTest: '/\\.webcomponent\\.pcss$/', filePathsExpression: "globSync('./src/**/*.webcomponent.pcss')" },
    {
      raw: false,
      webpackTest: '/(?<!\\.webcomponent)\\.pcss$/',
      filePathsExpression: "globSync('./src/**/*.pcss').filter((filePath) => !filePath.endsWith('.webcomponent.pcss'))",
    },
  ]
}

const addWebpackToolchain = ({ packageJson }: IProject) => {
  packageJson.devDependencies['@enhanced-dom/babel'] = LATEST
  packageJson.devDependencies['@enhanced-dom/webpack'] = LATEST
}

const applyBase = (project: IProject, options: IOptions, licensePath: string) => {
  const { packageJson, files } = project
  const shortName = packageJson.name.split('/').pop()
  packageJson.repository = `https://github.com/enhanced-dom/${shortName}.git`
  packageJson.scripts['configure-build'] = `@enhanced-dom-bootstrap-tsconfig --type=${options.type}`
  if (options.type !== ProjectType.BROWSER) {
    packageJson.devDependencies['@types/node'] = '^22.20.5'
  }

  files.set('README.md', `${options.description ? `${options.description}\n\n` : ''}## Getting started\n\nRun \`npm install\`.\n`)
  files.set('LICENSE.md', fs.readFileSync(licensePath, 'utf-8'))
  files.set('.gitignore', GITIGNORE)
  files.set('lint-staged.config.mjs', configFile('lintStagedConfigFactory'))
  files.set('prettier.config.mjs', configFile('prettierConfigFactory'))
  files.set(project.entryFile, 'export {}\n')
}

// typed-styles only emits raw (webcomponent) styles into dist; extracted (react) styles need their own build
const applyExtractedStyles = ({ packageJson, files }: IProject, options: IOptions) => {
  const extractedGroup = getStyleGroups(options).find(({ raw }) => !raw)
  if (!extractedGroup) {
    return
  }
  packageJson.scripts.build += ' && webpack --config styles.config.mjs'
  files.set(
    'styles.config.mjs',
    `import webpackConfigFactory from '@enhanced-dom/webpack'
import { globSync } from 'fs'
import path from 'path'

// each stylesheet becomes dist/<name>.css plus a dist/<name>.pcss.js class-name module (and its typings)
const filePaths = ${extractedGroup.filePathsExpression}
const STYLE_ENTRY_SUFFIX = '.style-entry.js'

export default () => ({
  mode: 'production',
  entry: Object.fromEntries(filePaths.map((filePath) => [path.relative('src', filePath).replace(/\\.pcss$/, ''), \`./\${filePath}\`])),
  output: { path: path.resolve('./dist'), filename: \`[name]\${STYLE_ENTRY_SUFFIX}\` },
  devtool: false,
  module: {
    rules: [
      {
        test: /\\.pcss$/,
        use: webpackConfigFactory.loaders
          .styleConfigFactory({ raw: false, extract: true, typedStyles: true, parser: 'postcss' })
          // the class-name module is only emitted when the typings loader is told to
          .map((loader) => (loader.options?.typings ? { ...loader, options: { ...loader.options, emit: true } } : loader)),
      },
    ],
  },
  plugins: [
    ...webpackConfigFactory.plugins.cssConfigFactory({ filename: '[name].css' }),
    // the js entries only exist to pull the stylesheets in
    {
      apply: (compiler) =>
        compiler.hooks.thisCompilation.tap('DropStyleEntries', (compilation) =>
          compilation.hooks.processAssets.tap(
            { name: 'DropStyleEntries', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE },
            (assets) => Object.keys(assets).filter((name) => name.endsWith(STYLE_ENTRY_SUFFIX)).forEach((name) => compilation.deleteAsset(name)),
          ),
        ),
    },
  ],
})
`,
  )
}

const applyCss = (project: IProject, options: IOptions) => {
  const { packageJson, files } = project
  addWebpackToolchain(project)
  packageJson.scripts.build += ' && webpack --config typed-styles.config.mjs'
  packageJson.scripts.css = 'webpack --config typed-styles.config.mjs --watch --mode=none'
  packageJson.scripts.lint += ' && stylelint --fix --config stylelint.config.mjs src/**/*.pcss'

  files.set('stylelint.config.mjs', configFile('stylelintConfigFactory'))
  const styleGroups = getStyleGroups(options)
    .map(({ raw, filePathsExpression }) => `  { raw: ${raw}, filePaths: ${filePathsExpression} },`)
    .join('\n')
  files.set(
    'typed-styles.config.mjs',
    `import webpackConfigFactory from '@enhanced-dom/webpack'
import { globSync } from 'fs'
import path from 'path'

const styleGroups = [
${styleGroups}
]

export default (_, argv) => {
  const willExport = argv.mode !== 'none'
  return styleGroups
    .filter(({ filePaths }) => filePaths.length)
    .map(({ raw, filePaths }) =>
      webpackConfigFactory.configs.typedStylesConfigFactory({
        raw,
        filePaths: filePaths.map((filePath) => \`./\${filePath}\`),
        outputPath: willExport ? path.resolve('./dist') : undefined,
      }),
    )
}
`,
  )
  files.set('src/index.pcss', ':root {\n}\n')
  applyExtractedStyles(project, options)
}

const applyReact = (project: IProject) => {
  const { packageJson, files } = project
  // react, react-dom and their typings come in as @enhanced-dom/react's own dependencies
  packageJson.dependencies['@enhanced-dom/react'] = LATEST
  packageJson.scripts['configure-build'] += ' --react'
  files.delete(project.entryFile)
  project.entryFile = 'src/index.tsx'
  files.set(project.entryFile, `import React from 'react'\n\nexport const App = () => <></>\n`)
}

const applyWebcomponent = (project: IProject, options: IOptions) => {
  const { packageJson, files } = project
  packageJson.dependencies['@enhanced-dom/webcomponent'] = LATEST
  // react+webcomponent wiring (via @enhanced-dom/react's adapter) is not generated yet: react's entry wins
  if (options.features.includes(Feature.REACT)) {
    return
  }
  const shortName = packageJson.name.split('/').pop() ?? ''
  const className = `${shortName
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}WebComponent`
  files.set(
    project.entryFile,
    `import { WebcomponentRenderer, type IRenderingEngine } from '@enhanced-dom/webcomponent'

export class ${className} extends HTMLElement {
  static tag = 'enhanced-dom-${shortName}'

  static register = () => {
    if (!window.customElements.get(${className}.tag)) {
      window.customElements.define(${className}.tag, ${className})
    }
  }

  static template = () => []
  static renderer: IRenderingEngine = new WebcomponentRenderer('${SCOPE}/${className}', ${className}.template)

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
  }

  render() {
    if (this.shadowRoot) {
      ${className}.renderer.render(this.shadowRoot)
    }
  }
}
`,
  )
}

const applyTests = (project: IProject, options: IOptions) => {
  const { packageJson, files } = project
  if (options.tests !== TestRunner.JEST) {
    return
  }
  packageJson.devDependencies['@enhanced-dom/jest'] = LATEST
  // jest runs under node, so tests need node typings even in browser projects
  packageJson.devDependencies['@types/node'] = '^22.20.5'
  packageJson.scripts.test = 'jest --config test/jest.config.mjs --runInBand'
  packageJson.scripts.lint = (packageJson.scripts.lint ?? '').replace('eslint src/**', 'eslint src/** test/**')
  project.eslintEnv.push('jest')
  // fallow doesn't pick up a jest config living in test/, so the test files need to be declared as entries
  packageJson.scripts['configure-lint'] = (packageJson.scripts['configure-lint'] ?? '').replace(
    '@enhanced-dom-fallow --gitignore',
    "@enhanced-dom-fallow --gitignore --entry 'test/**/*.test.ts'",
  )

  const isReact = options.features.includes(Feature.REACT)
  files.set(
    'test/jest.config.mjs',
    `import { jestConfigFactory } from '@enhanced-dom/jest'

const baseConfig = jestConfigFactory({ ts: true, processorConfigPath: new URL('./tsconfig.json', import.meta.url).pathname })

export default {
  ...baseConfig,
  transformIgnorePatterns: ['node_modules/(?!@enhanced-dom/|lodash-es)'],
}
`,
  )
  files.set(
    'test/tsconfig.json',
    json({
      extends: '../tsconfig.json',
      compilerOptions: { allowJs: true, rootDir: '..', types: ['node', 'jest'] },
      include: isReact ? ['./**/*.ts', './**/*.tsx', '../src/**/*.ts', '../src/**/*.tsx'] : ['./**/*.ts', '../src/**/*.ts'],
    }),
  )
}

// bundles dist's build output (plus its deps) into a single standalone dist/*.js file; build itself stays plain tsc
const applyStandalone = (project: IProject) => {
  const { packageJson } = project
  packageJson.devDependencies['@vercel/ncc'] = '^0.45.0'
  const entryBasename = path.basename(project.entryFile).replace(/\.tsx?$/, '')
  packageJson.scripts.package = `ncc build ./dist/${entryBasename}.js -o ./dist`
}

const applyDemo = (project: IProject, options: IOptions) => {
  const { packageJson, files } = project
  addWebpackToolchain(project)
  packageJson.scripts.demo = 'webpack serve --config ./demo/webpack.config.mjs'
  packageJson.scripts.docs = 'webpack build --config ./demo/webpack.config.mjs --mode=production'

  const styleRule = options.features.includes(Feature.CSS)
    ? getStyleGroups(options)
        .map(
          ({ raw, webpackTest }) => `
        {
          test: ${webpackTest},
          use: webpackConfigFactory.loaders.styleConfigFactory({
            sourceMap: !isProduction,
            parser: 'postcss',
            typedStyles: true,
            modules: true,
            raw: ${raw},
            extract: ${!raw},
          }),
        },`,
        )
        .join('')
    : ''
  files.set(
    'demo/webpack.config.mjs',
    `import path from 'path'
import { configFactory as babelConfigFactory } from '@enhanced-dom/babel'
import webpackConfigFactory from '@enhanced-dom/webpack'

export default (env = {}, argv = {}) => {
  const isProduction = argv.mode === 'production'
  const isAnalyzing = !!env.analyze
  const babelConfig = babelConfigFactory()

  return {
    mode: isProduction ? 'production' : 'development',
    entry: { bundle: [\`./\${path.relative(process.cwd(), path.resolve(import.meta.dirname, '../${project.entryFile}'))}\`] },
    output: {
      filename: 'bundle-[contenthash].js',
      publicPath: '/',
      path: path.resolve(import.meta.dirname, '../docs'),
      clean: isProduction,
    },
    devtool: isProduction ? false : 'source-map',
    resolve: {
      modules: ['./node_modules', path.resolve('./node_modules')],
      extensions: ['.tsx', '.ts', '.json', '.js', '.jsx'],
    },
    optimization: {
      concatenateModules: !isAnalyzing,
      minimize: isProduction,
      emitOnErrors: !isProduction,
    },
    module: {
      rules: [
        {
          test: /\\.tsx?$/,
          exclude: /node_modules/,
          use: webpackConfigFactory.loaders.babelConfigFactory({ babel: babelConfig, cache: false }),
        },${styleRule}
        {
          test: /\\.jsx?$/,
          include: /@enhanced-dom/,
          use: webpackConfigFactory.loaders.babelConfigFactory({ babel: babelConfig, cache: true }),
        },
      ].concat(isProduction ? [] : [{ test: /\\.jsx?$/, loader: 'source-map-loader', enforce: 'pre', include: /@enhanced-dom/ }]),
    },
    plugins: [
      ...webpackConfigFactory.plugins.htmlConfigFactory({
        embed: isProduction && !isAnalyzing,
        compress: isProduction && !isAnalyzing,
        html: {
          minify: isProduction,
          title: '${packageJson.name} demo',
        },
      }),
      ...webpackConfigFactory.plugins.cssConfigFactory(),
      ...(isAnalyzing ? webpackConfigFactory.plugins.bundleAnalyzerConfigFactory() : []),
    ],
    devServer: { historyApiFallback: true, port: 3000 },
  }
}
`,
  )
}

const contributors: Partial<Record<Feature, (project: IProject, options: IOptions) => void>> = {
  [Feature.CSS]: applyCss,
  [Feature.REACT]: applyReact,
  [Feature.WEBCOMPONENT]: applyWebcomponent,
  [Feature.DEMO]: applyDemo,
  [Feature.STANDALONE]: applyStandalone,
}

// order matters: react may swap the entry file, which webcomponent, demo and standalone then build on
const FEATURE_ORDER = [Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT, Feature.DEMO, Feature.STANDALONE]

const createProject = (options: IOptions): IProject => ({
  packageJson: {
    name: options.name.startsWith('@') ? options.name : `${SCOPE}/${options.name}`,
    version: '0.1.0',
    description: options.description,
    repository: '',
    type: 'module',
    main: 'index.js',
    scripts: {
      'configure-claude': '@enhanced-dom-claude --configs react code agent rtk devcontainer caveman-lite',
      'configure-lint':
        '@enhanced-dom-fallow --gitignore && @enhanced-dom-npmrc --gitignore && @enhanced-dom-nvmrc --gitignore && @enhanced-dom-husky --gitignore',
      'configure-build': '',
      prepare: 'npm run configure-lint && npm run configure-claude && npm run configure-build',
      package: 'cd dist && npm pack',
      prebuild: 'rimraf dist/*',
      build: 'tsc -p ./tsconfig.json',
      typecheck: 'tsc -p ./tsconfig.json --noEmit',
      postbuild: 'tsc-esm-fix --tsconfig=./tsconfig.json && copyfiles LICENSE.md README.md dist && @enhanced-dom-copy-packagejson',
      lint: 'eslint src/** --fix --config eslint.config.mjs',
    },
    keywords: [],
    author: AUTHOR,
    license: 'MIT',
    dependencies: {},
    devDependencies: {
      '@enhanced-dom/build': LATEST,
      '@enhanced-dom/lint': LATEST,
      '@enhanced-dom/claude': LATEST,
    },
    engines: {
      node: '>=22.23.2',
      npm: '>=12',
    },
  },
  files: new Map(),
  entryFile: 'src/index.ts',
  eslintEnv: [options.type === ProjectType.NODE ? 'node' : 'browser'],
})

const fetchLatestVersion = async (packageName: string) => {
  const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2f')}/latest`)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const { version } = (await response.json()) as { version: string }
  return version
}

// pins LATEST to a caret range; if the registry is unreachable, the "latest" dist-tag stays and npm install still resolves it
const applyLatestScopedVersions = async ({ packageJson }: IProject) => {
  const dependencyGroups = [packageJson.dependencies, packageJson.devDependencies]
  const scopedNames = [...new Set(dependencyGroups.flatMap((group) => Object.keys(group)))].filter((name) => name.startsWith(`${SCOPE}/`))
  await Promise.all(
    scopedNames.map(async (name) => {
      try {
        const version = `^${await fetchLatestVersion(name)}`
        dependencyGroups.filter((group) => name in group).forEach((group) => (group[name] = version))
      } catch (error) {
        console.log(`Could not resolve latest ${name} (${String(error)}), leaving "${LATEST}"`)
      }
    }),
  )
}

export const generate = async (options: IOptions, licensePath = path.join(import.meta.dirname, 'LICENSE.md')) => {
  const project = createProject(options)
  applyBase(project, options, licensePath)
  FEATURE_ORDER.filter((feature) => options.features.includes(feature)).forEach((feature) => contributors[feature]?.(project, options))
  applyTests(project, options)
  await applyLatestScopedVersions(project)
  // the lint factory defaults env to ['browser'], and a passed env replaces that default rather than extending it
  const isDefaultEslintEnv = project.eslintEnv.length === 1 && project.eslintEnv[0] === 'browser'
  const eslintEnv = isDefaultEslintEnv ? '' : `\n  env: [${project.eslintEnv.map((env) => `'${env}'`).join(', ')}],`
  project.files.set('eslint.config.mjs', configFile('eslintConfigFactory', `{\n  ignore: ['**/*.d.ts'],${eslintEnv}\n}`))
  project.files.set('package.json', json(project.packageJson))
  return project.files
}

export const write = (files: Map<string, string>, options: IOptions) => {
  const destFolder = path.resolve(process.cwd(), options.folder)
  files.forEach((content, relativePath) => {
    const destPath = path.join(destFolder, relativePath)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, content)
  })
}
