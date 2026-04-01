'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

const links = [
  { href: '/resume', label: 'Resume' },
  { href: '/sources', label: 'Sources' },
  { href: '/import', label: 'Import' },
]

export function Nav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl h-12">
      <div className="max-w-[1128px] mx-auto px-6 h-full flex items-center gap-6">
        <Link href="/" className="font-semibold text-sm text-foreground hover:text-foreground/80">
          Job Tracker
        </Link>

        {/* Desktop links */}
        <div className="hidden sm:flex items-center gap-6 flex-1">
          {links.map(({ href, label }) => (
            href === '/import' ? (
              <Link
                key={href}
                href={href}
                className="text-sm ml-auto px-3 py-1 rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
              >
                {label}
              </Link>
            ) : (
              <Link
                key={href}
                href={href}
                className={`text-sm transition-colors ${pathname === href ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </Link>
            )
          ))}
        </div>

        {/* Mobile burger */}
        <div className="flex-1 sm:hidden" />
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {menuOpen ? <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></> : <><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></>}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="sm:hidden overflow-hidden border-b bg-background/95 backdrop-blur-xl"
          >
            <div className="px-6 py-3 flex flex-col gap-3">
              {links.map(({ href, label }) => (
                href === '/import' ? (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="text-sm font-medium text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                ) : (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={`text-sm transition-colors ${pathname === href ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </Link>
                )
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
