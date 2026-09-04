            import { NextResponse } from 'next/server'
            import handler from "./robots.ts"
            import { resolveRouteData } from
'next/dist/build/webpack/loaders/metadata/resolve-route-data'

            const contentType = "text/plain"
            const cacheControl = "public, max-age=0, must-revalidate"
            const fileType = "robots"

            if (typeof handler !== 'function') {
                throw new Error('Default export is missing in "./robots.ts"')
            }

            export async function GET() {
              const data = await handler()
              const content = resolveRouteData(data, fileType)

              return new NextResponse(content, {
                headers: {
                  'Content-Type': contentType,
                  'Cache-Control': cacheControl,
                },
              })
            }

            export * from "./robots.ts"
        