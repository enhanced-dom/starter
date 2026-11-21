import { parseArgs } from '../src/cli.js'
import { Feature, ProjectType, TestRunner } from '../src/generator.js'

describe('argument parsing', () => {
  test('CLI-1: reads single-dash long flags as whole names rather than letter groups', () => {
    const options = parseArgs(['out', '-name', 'widget', '-type=node', '-tests', 'jest', '-css', '-demo'])
    expect(options).toEqual({
      folder: 'out',
      name: 'widget',
      description: '',
      type: ProjectType.NODE,
      tests: TestRunner.JEST,
      features: [Feature.CSS, Feature.DEMO],
    })
  })

  test('CLI-2: accepts double-dash flags too', () => {
    const options = parseArgs(['out', '--name', 'widget', '--react', '--description', 'A widget'])
    expect(options.features).toEqual([Feature.REACT])
    expect(options.description).toBe('A widget')
  })

  test('CLI-3: defaults to an isomorphic project with no tests and no features', () => {
    const options = parseArgs(['out', '-name', 'widget'])
    expect(options.type).toBe(ProjectType.ISOMORPHIC)
    expect(options.tests).toBeUndefined()
    expect(options.features).toEqual([])
  })

  test('CLI-4: reads -standalone', () => {
    const options = parseArgs(['out', '-name', 'widget', '-standalone'])
    expect(options.features).toEqual([Feature.STANDALONE])
  })

  test('CLI-5: reads -repository', () => {
    const options = parseArgs(['out', '-name', '@enhanced-dom-react/icon', '-repository', 'enhanced-dom/react-icon'])
    expect(options.repository).toBe('enhanced-dom/react-icon')
  })
})
