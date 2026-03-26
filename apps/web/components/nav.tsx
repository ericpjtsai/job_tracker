'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/resume', label: 'Resume' },
  { href: '/sources', label: 'Sources' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold text-sm tracking-[-0.02em] text-foreground hover:text-foreground/80">
          Job Tracker
        </Link>
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`text-sm transition-colors ${pathname === href ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
