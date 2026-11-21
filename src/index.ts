#!/usr/bin/env node
import { parseArgs } from './cli.js'
import { generate, write } from './generator.js'

const options = parseArgs(process.argv.slice(2))
write(await generate(options), options)
