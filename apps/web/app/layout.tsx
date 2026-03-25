import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import Link from 'next/link'

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
          {/* Nav */}
          <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
              <Link href="/" className="font-semibold text-sm tracking-[-0.02em] text-foreground hover:text-foreground/80">
                Job Tracker
              </Link>
              <Link href="/resume" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Resume
              </Link>
              <Link href="/sources" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Sources
              </Link>
            </div>
          </nav>

          <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  )
}
