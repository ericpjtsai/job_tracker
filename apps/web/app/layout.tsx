import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/nav'
import { DemoModeProvider } from '@/lib/demo-mode'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Job Tracker',
  description: 'B2B Product Design job search agent',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans`}>
        <DemoModeProvider>
          <div className="min-h-screen bg-background">
            <Nav />
            <main className="max-w-[1128px] mx-auto px-6 py-6">{children}</main>
          </div>
        </DemoModeProvider>
      </body>
    </html>
  )
}
