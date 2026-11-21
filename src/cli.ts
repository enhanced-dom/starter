import yargs from 'yargs'

import { Feature, ProjectType, SCOPE, TestRunner, type IOptions } from './generator.js'

export const parseArgs = (argv: string[]): IOptions => {
  // short-option-groups off: otherwise yargs reads `-name` as `-n -a -m -e`
  const args = yargs(argv)
    .parserConfiguration({ 'short-option-groups': false })
    .usage(
      '$0 <folder> -name <name> [-description <text>] [-repository <org/repo>] [-type node|browser|isomorphic] [-tests jest] [-css] [-react] [-webcomponent] [-demo] [-standalone]',
    )
    .demandCommand(1, 'Destination folder is required')
    .string('name')
    .demandOption('name')
    .describe('name', `Package name, scoped to ${SCOPE} unless already scoped`)
    .string('description')
    .default('description', '')
    .string('repository')
    .describe('repository', 'GitHub "org/repo" slug, when it differs from the package name (default: enhanced-dom/<package short name>)')
    .choices('type', Object.values(ProjectType))
    .default('type', ProjectType.ISOMORPHIC)
    .string('tests')
    .choices('tests', Object.values(TestRunner))
    .describe('tests', 'Test runner setup')
    .boolean(Object.values(Feature))
    .describe(Feature.CSS, 'Stylelint + typed styles (.pcss)')
    .describe(Feature.REACT, 'React dependencies and .tsx entry')
    .describe(Feature.WEBCOMPONENT, 'Webcomponent dependency and custom element entry')
    .describe(Feature.DEMO, 'Webpack dev-server demo app')
    .describe(Feature.STANDALONE, 'Bundle the build output into a single file with @vercel/ncc')
    .strict()
    .parseSync()

  return {
    folder: String(args._[0]),
    name: args.name,
    description: args.description,
    repository: args.repository,
    type: args.type,
    tests: args.tests,
    features: Object.values(Feature).filter((feature) => args[feature]),
  }
}
