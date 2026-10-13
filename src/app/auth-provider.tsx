'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  getRecentGroups,
  getStarredGroups,
  getArchivedGroups,
  RecentGroup,
} from '@/app/groups/recent-groups-helpers'
import { useToast } from '@/components/ui/use-toast'
import { useRouter, useSearchParams } from 'next/navigation'

export type AuthUser = {
  id: string
  email: string
  name?: string | null
  image?: string | null
}

type AuthContextType = {
  user: AuthUser | null
  loading: boolean
  isConfigured: boolean
  loginWithGoogle: () => void
  logout: () => Promise<void>
  syncCloud: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isConfigured: false,
  loginWithGoogle: () => {},
  logout: async () => {},
  syncCloud: async () => {},
})

function AuthInner({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [isConfigured, setIsConfigured] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  // 1. Fetch current user
  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = (await res.json()) as { user?: AuthUser | null; isConfigured?: boolean }
        setUser(data.user ?? null)
        setIsConfigured(data.isConfigured ?? false)
        return (data.user ?? null) as AuthUser | null
      }
    } catch {
      // Offline or network error
    } finally {
      setLoading(false)
    }
    return null
  }, [])

  // 2. Synchronize local groups with server
  const syncCloud = useCallback(async () => {
    try {
      const localGroups = getRecentGroups()
      const localStarred = getStarredGroups()
      const localArchived = getArchivedGroups()

      const res = await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groups: localGroups,
          starredGroups: localStarred,
          archivedGroups: localArchived,
        }),
      })

      if (res.ok) {
        const data = (await res.json()) as {
          synced?: boolean
          groups?: RecentGroup[]
          starredGroups?: string[]
          archivedGroups?: string[]
        }
        if (data.synced && Array.isArray(data.groups)) {
          // Merge server groups with local storage
          const serverGroups: RecentGroup[] = data.groups
          const combinedMap = new Map<string, RecentGroup>()

          // Server groups first
          for (const g of serverGroups) {
            combinedMap.set(g.id, g)
          }
          // Local groups added
          for (const g of localGroups) {
            if (!combinedMap.has(g.id)) {
              combinedMap.set(g.id, g)
            }
          }

          const mergedGroups = Array.from(combinedMap.values())
          localStorage.setItem('recentGroups', JSON.stringify(mergedGroups))

          if (Array.isArray(data.starredGroups)) {
            const mergedStarred = Array.from(
              new Set([...localStarred, ...data.starredGroups])
            )
            localStorage.setItem('starredGroups', JSON.stringify(mergedStarred))
          }

          if (Array.isArray(data.archivedGroups)) {
            const mergedArchived = Array.from(
              new Set([...localArchived, ...data.archivedGroups])
            )
            localStorage.setItem('archivedGroups', JSON.stringify(mergedArchived))
          }

          // Trigger custom event so page components re-render groups
          window.dispatchEvent(new Event('hisaab-groups-synced'))
        }
      }
    } catch (err) {
      console.warn('Sync with cloud failed:', err)
    }
  }, [])

  useEffect(() => {
    fetchUser().then((currentUser) => {
      if (currentUser) {
        syncCloud()
      }
    })
  }, [fetchUser, syncCloud])

  // Handle URL auth query parameters
  useEffect(() => {
    const authStatus = searchParams.get('auth')
    const authError = searchParams.get('auth_error')

    if (authStatus === 'success') {
      toast({
        title: 'Signed in with Google',
        description: 'Your groups are now synced across devices!',
      })
      // Clear query param
      router.replace(window.location.pathname)
      fetchUser().then((u) => {
        if (u) syncCloud()
      })
    } else if (authError) {
      if (authError === 'google_credentials_missing') {
        toast({
          title: 'Google OAuth Setup Required',
          description:
            'Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your Vercel or local .env to enable Google Sign-In.',
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Authentication Error',
          description: `Google sign in could not be completed (${authError}).`,
          variant: 'destructive',
        })
      }
      router.replace(window.location.pathname)
    }
  }, [searchParams, toast, router, fetchUser, syncCloud])

  const loginWithGoogle = () => {
    window.location.href = '/api/auth/google'
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setUser(null)
      toast({
        title: 'Signed out',
        description: 'You are now browsing anonymously. Local groups are preserved.',
      })
    } catch {
      // Ignore
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isConfigured,
        loginWithGoogle,
        logout,
        syncCloud,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={children}>
      <AuthInner>{children}</AuthInner>
    </React.Suspense>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
