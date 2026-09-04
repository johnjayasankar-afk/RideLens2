import { NextResponse } from 'next/server'

const contentType = "image/svg+xml"
const cacheControl = "public, max-age=0, must-revalidate"
const buffer = Buffer.from("PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+CiAgPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjZWZlOGQ5Ii8+CiAgPHJlY3QgeD0iNiIgeT0iMTAiIHdpZHRoPSI0IiBoZWlnaHQ9IjEyIiBmaWxsPSIjN2EyNDMzIi8+CiAgPHJlY3QgeD0iMTQiIHk9IjYiIHdpZHRoPSI0IiBoZWlnaHQ9IjIwIiBmaWxsPSIjMTYxMjBkIi8+CiAgPHJlY3QgeD0iMjIiIHk9IjEwIiB3aWR0aD0iNCIgaGVpZ2h0PSIxMiIgZmlsbD0iIzdhMjQzMyIvPgo8L3N2Zz4K", 'base64')

export function GET() {
    return new NextResponse(buffer, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
        },
    })
}

export const dynamic = 'force-static'
