'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface DemoModeContextType {
  isDemo: boolean
  login: (password: string) => boolean
  logout: () => void
}

const DemoModeContext = createContext<DemoModeContextType>({
  isDemo: true,
  login: () => false,
  logout: () => {},
})

const COOKIE_NAME = 'admin-session'
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'ericpjT'

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState(true)

  // Restore admin session from cookie on mount
  useEffect(() => {
    if (getCookie(COOKIE_NAME) === 'true') {
      setIsDemo(false)
    }
  }, [])

  function login(password: string): boolean {
    if (password === ADMIN_PASSWORD) {
      setIsDemo(false)
      setCookie(COOKIE_NAME, 'true', 7)
      return true
    }
    return false
  }

  function logout() {
    setIsDemo(true)
    deleteCookie(COOKIE_NAME)
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
