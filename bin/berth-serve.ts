import { start } from '../src/server/index'
start().catch(e => { console.error(e); process.exit(1) })
