import { start } from '../src/server/index'
import { formatStartupError } from '../src/startup-error'

start().catch(e => { console.error(formatStartupError(e)); process.exit(1) })
