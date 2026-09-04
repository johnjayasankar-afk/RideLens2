import { NextResponse } from 'next/server'
import { default as handler } from "./sitemap.ts"
import { resolveRouteData } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'

const contentType = "application/xml"
const cacheControl = "public, max-age=0, must-revalidate"
const fileType = "sitemap"

if (typeof handler !== 'function') {
    throw new Error('Default export is missing in "./sitemap.ts"')
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

export * from "./sitemap.ts"
