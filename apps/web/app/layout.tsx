import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { Nav } from '@/components/nav'

const inter = Inter({ subsets: ['latin'] })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-label' })

export const metadata: Metadata = {
  title: 'Job Tracker',
  description: 'B2B Product Design job search agent',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set api-token cookie so client-side fetches pass middleware auth
  const secret = process.env.SECRET_API_TOKEN
  if (secret) {
    const jar = await cookies()
    if (!jar.get('api-token')) {
      jar.set('api-token', secret, { httpOnly: true, sameSite: 'strict', secure: true, path: '/' })
    }
  }

  return (
    <html lang="en">
      <body className={`${inter.className} ${spaceGrotesk.variable}`}>
        <div className="min-h-screen bg-background">
          <Nav />
          <main className="max-w-[1128px] mx-auto px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  )
}
