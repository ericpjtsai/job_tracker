'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useDemoMode } from '@/lib/demo-mode'

const links = [
  { href: '/resume', label: 'Resume' },
  { href: '/sources', label: 'Sources' },
  { href: '/import', label: 'Import' },
]

export function Nav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const { isDemo, login, logout } = useDemoMode()
  const [showPasswordInput, setShowPasswordInput] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleLogin() {
    if (await login(password)) {
      setShowPasswordInput(false)
      setPassword('')
      setError(false)
    } else {
      setError(true)
      setTimeout(() => setError(false), 1500)
    }
  }

  async function handleToggleClick() {
    if (!isDemo) {
      await logout()
    } else {
      setShowPasswordInput(true)
      setPassword('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

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
                className="text-sm px-3 py-1 rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
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

        {/* Demo/Admin toggle */}
        <div className="hidden sm:flex items-center gap-2">
          {showPasswordInput ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); if (e.key === 'Escape') { setShowPasswordInput(false); setPassword('') } }}
                placeholder="Password"
                className={`text-xs w-24 px-2 py-1 rounded-md border bg-transparent focus:outline-none ${error ? 'border-rose-400 text-rose-700' : 'border-input'}`}
              />
              <button type="button" aria-label="Submit password" onClick={handleLogin} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
              <button type="button" aria-label="Cancel" onClick={() => { setShowPasswordInput(false); setPassword('') }} className="text-xs text-muted-foreground/40 hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          ) : (
            <button type="button" onClick={handleToggleClick} className={`text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${isDemo ? 'bg-muted text-muted-foreground hover:text-foreground' : 'bg-emerald-500/15 text-emerald-800'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isDemo
                  ? <><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                  : <><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>
                }
              </svg>
              {isDemo ? 'Demo' : 'Admin'}
            </button>
          )}
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
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={`text-sm transition-colors ${pathname === href ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </Link>
              ))}
              <button type="button" onClick={handleToggleClick} className={`text-sm text-left transition-colors ${isDemo ? 'text-muted-foreground' : 'text-emerald-800'}`}>
                {isDemo ? 'Switch to Admin' : 'Switch to Demo'}
              </button>
              {showPasswordInput && (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                    placeholder="Password"
                    autoFocus
                    className={`text-sm flex-1 px-3 py-1.5 rounded-md border bg-transparent focus:outline-none ${error ? 'border-rose-400' : 'border-input'}`}
                  />
                  <button type="button" onClick={handleLogin} className="text-sm text-muted-foreground hover:text-foreground">Go</button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}
