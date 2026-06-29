import { start } from '../src/server/index'
import { findReusableServer } from '../src/server-resolve'
import { serveOrReuse } from '../src/serve'
import { formatStartupError } from '../src/startup-error'

// Reuse a Berth server that's already running (e.g. the desktop app) instead of binding a second one
// and failing with EADDRINUSE — `npm start` after the app should just point at the live server.
serveOrReuse({ find: findReusableServer, start: () => start(), log: console.log })
  .catch(e => { console.error(formatStartupError(e)); process.exit(1) })
