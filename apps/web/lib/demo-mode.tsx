'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface DemoModeContextType {
  isDemo: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
}

const DemoModeContext = createContext<DemoModeContextType>({
  isDemo: true,
  login: async () => false,
  logout: async () => {},
})

// UI-only flag. The real auth check is server-side via an HMAC-signed
// httpOnly cookie (see lib/admin-auth.ts + middleware.ts). Forging
// admin-flag=1 does not grant any write access.
const FLAG_COOKIE = 'admin-flag'

function hasFlag(): boolean {
  return document.cookie.split('; ').some(c => c.startsWith(`${FLAG_COOKIE}=1`))
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState(true)

  useEffect(() => {
    // Optimistic: if the (forgeable) flag is set, render as admin immediately.
    // Then verify against the server — which HMAC-checks the httpOnly session
    // cookie — and correct if the flag was forged or expired.
    if (hasFlag()) setIsDemo(false)
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { admin: false })
      .then(({ admin }) => setIsDemo(!admin))
      .catch(() => { /* keep optimistic state on network error */ })
  }, [])

  async function login(password: string): Promise<boolean> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) return false
    setIsDemo(false)
    return true
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' })
    setIsDemo(true)
  }

  return (
    <DemoModeContext.Provider value={{ isDemo, login, logout }}>
      {children}
    </DemoModeContext.Provider>
  )
}

export function useIsDemo() {
  return useContext(DemoModeContext).isDemo
}

export function useDemoMode() {
  return useContext(DemoModeContext)
}
