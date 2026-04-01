import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/nav'

const inter = Inter({ subsets: ['latin'] })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-label' })

export const metadata: Metadata = {
  title: 'Job Tracker',
  description: 'B2B Product Design job search agent',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
