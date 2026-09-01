import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Runs the api/*.js Vercel functions inside `npm run dev` so the dashboard can
// be exercised locally exactly as it behaves in production. Dev only — Vercel
// serves these itself once deployed.
function vercelApiDev() {
  return {
    name: 'vercel-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()

        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '')
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) return next()
        if (!existsSync(resolve(server.config.root, 'api', `${name}.js`))) return next()

        const shim = {
          statusCode: 200,
          setHeader: (k, v) => res.setHeader(k, v),
          status(code) { this.statusCode = code; return this },
          json(body) {
            res.statusCode = this.statusCode
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
            return this
          }
        }

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          await mod.default({
            query: Object.fromEntries(url.searchParams),
            method: req.method,
            url: req.url,
            headers: req.headers
          }, shim)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), vercelApiDev()],
  server: {
    port: 3000
  }
})
