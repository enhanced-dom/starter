import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

import { Feature, ProjectType, generate, write, type IOptions } from '../src/generator.js'

// generated projects live inside the repo so their configs resolve this repo's node_modules
const GENERATED_ROOT = path.resolve(import.meta.dirname, '../.generated')
const WEBPACK_BIN = path.resolve(import.meta.dirname, '../node_modules/.bin/webpack')
const LICENSE_PATH = path.resolve(import.meta.dirname, '../LICENSE.md')
const BUILD_TIMEOUT = 120_000

const WEBCOMPONENT_STYLESHEET = 'src/index.webcomponent.pcss'

const generateProject = async (name: string, features: Feature[]) => {
  const folder = path.join(GENERATED_ROOT, name)
  fs.rmSync(folder, { recursive: true, force: true })
  const options: IOptions = { folder, name, description: '', type: ProjectType.BROWSER, features }
  write(await generate(options, LICENSE_PATH), options)
  return folder
}

// the generated entry doesn't import any styles, so wire them in to make the demo's style rules actually run
const useStylesheets = (folder: string, stylesheets: string[]) => {
  stylesheets.forEach((stylesheet) => fs.writeFileSync(path.join(folder, stylesheet), '.root { color: red; }\n'))
  const entry = ['src/index.tsx', 'src/index.ts'].find((file) => fs.existsSync(path.join(folder, file))) ?? ''
  const imports = stylesheets.map((stylesheet, index) => `import * as styles${index} from './${path.basename(stylesheet)}'`)
  fs.writeFileSync(
    path.join(folder, entry),
    `${imports.join('\n')}\nconsole.log(${stylesheets.map((_, index) => `styles${index}`).join(', ')})\n`,
  )
}

const runWebpack = (folder: string, args: string[]) => execFileSync(WEBPACK_BIN, args, { cwd: folder, stdio: 'pipe' })

beforeEach(() => {
  // versions are irrelevant to the builds; skip the registry
  jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('', { status: 503 }))
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  fs.rmSync(GENERATED_ROOT, { recursive: true, force: true })
})

describe('generated webpack configs', () => {
  test.each([
    ['typed-styles-plain', [Feature.CSS], []],
    ['typed-styles-react', [Feature.CSS, Feature.REACT], []],
    ['typed-styles-react-webcomponent', [Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT], [WEBCOMPONENT_STYLESHEET]],
  ])(
    'BUILDS-1: the %s typed-styles config emits typings for every stylesheet',
    async (name, features, extraStylesheets) => {
      const folder = await generateProject(name, features)
      extraStylesheets.forEach((stylesheet) => fs.writeFileSync(path.join(folder, stylesheet), '.root { color: red; }\n'))
      runWebpack(folder, ['--config', 'typed-styles.config.mjs'])
      ;['src/index.pcss', ...extraStylesheets].forEach((stylesheet) =>
        expect(fs.existsSync(path.join(folder, `${stylesheet}.d.ts`))).toBe(true),
      )
    },
    BUILD_TIMEOUT,
  )

  test(
    'BUILDS-3: react stylesheets compile to dist css with resolved imports and a matching class-name module, leaving webcomponent styles raw',
    async () => {
      const folder = await generateProject('extracted-styles', [Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT])
      fs.mkdirSync(path.join(folder, 'src/parts'))
      fs.writeFileSync(path.join(folder, 'src/parts/base.pcss'), '.base { margin: 0; }\n')
      fs.writeFileSync(
        path.join(folder, 'src/index.pcss'),
        "@import './parts/base.pcss';\n.root {\n  color: red;\n  .inner { color: blue; }\n}\n",
      )
      fs.writeFileSync(path.join(folder, WEBCOMPONENT_STYLESHEET), '.shell { color: green; }\n')
      runWebpack(folder, ['--config', 'typed-styles.config.mjs'])
      runWebpack(folder, ['--config', 'styles.config.mjs'])

      const dist = (file: string) => path.join(folder, 'dist', file)
      const css = fs.readFileSync(dist('index.css'), 'utf-8')
      const classNames = Object.fromEntries(
        [...fs.readFileSync(dist('index.pcss.js'), 'utf-8').matchAll(/export const (\w+)\s*=\s*["']([^"']+)["']/g)].map(
          ([, name, value]) => [name, value],
        ),
      )
      expect(Object.keys(classNames).sort()).toEqual(['base', 'inner', 'root'])
      expect(css).toContain(`.${classNames.base}{margin:0}`)
      expect(css).toContain(`.${classNames.root} .${classNames.inner}{color:blue}`)
      expect(fs.existsSync(dist('index.pcss.d.ts'))).toBe(true)
      expect(fs.existsSync(dist('index.webcomponent.pcss.js'))).toBe(true)
      expect(fs.existsSync(dist('index.webcomponent.css'))).toBe(false)
      expect(
        fs.readdirSync(path.join(folder, 'dist'), { recursive: true }).filter((file) => String(file).endsWith('.style-entry.js')),
      ).toEqual([])
    },
    BUILD_TIMEOUT,
  )

  test.each([
    ['demo-plain', [Feature.DEMO], []],
    ['demo-react', [Feature.DEMO, Feature.REACT], []],
    ['demo-webcomponent', [Feature.DEMO, Feature.WEBCOMPONENT], []],
    ['demo-css', [Feature.DEMO, Feature.CSS], ['src/index.pcss']],
    ['demo-css-react', [Feature.DEMO, Feature.CSS, Feature.REACT], ['src/index.pcss']],
    [
      'demo-css-react-webcomponent',
      [Feature.DEMO, Feature.CSS, Feature.REACT, Feature.WEBCOMPONENT],
      ['src/index.pcss', WEBCOMPONENT_STYLESHEET],
    ],
  ])(
    'BUILDS-2: the %s demo config builds a production bundle',
    async (name, features, stylesheets) => {
      const folder = await generateProject(name, features)
      useStylesheets(folder, stylesheets)
      runWebpack(folder, ['build', '--config', './demo/webpack.config.mjs', '--mode=production'])
      expect(fs.existsSync(path.join(folder, 'docs/index.html'))).toBe(true)
    },
    BUILD_TIMEOUT,
  )
})
