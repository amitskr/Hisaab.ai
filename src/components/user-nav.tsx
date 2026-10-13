'use client'

import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Cloud, LogOut, Check, RefreshCw } from 'lucide-react'
import Image from 'next/image'

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="16" height="16">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

export function UserNav() {
  const { user, loading, loginWithGoogle, logout, syncCloud } = useAuth()

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-muted/40 animate-pulse" />
  }

  if (!user) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={loginWithGoogle}
        className="gap-1.5 text-xs font-medium text-foreground bg-white/70 dark:bg-card/70 hover:bg-muted border-border/80 shadow-2xs h-8 px-2 sm:px-2.5"
        title="Sign in with Google to sync groups across devices"
      >
        <GoogleIcon className="w-4 h-4 shrink-0" />
        <span className="hidden sm:inline">Sign in</span>
      </Button>
    )
  }

  const initial = user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full h-8 w-8 p-0">
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name || 'User'}
              width={30}
              height={30}
              className="rounded-full ring-1 ring-border"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
              {initial}
            </div>
          )}
          {/* Subtle green sync status dot */}
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-background" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5 text-xs">
        <DropdownMenuLabel className="font-normal p-2">
          <div className="flex flex-col space-y-1">
            <p className="font-semibold text-sm leading-none">{user.name || 'User'}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => syncCloud()}
          className="gap-2 cursor-pointer text-xs"
        >
          <Check className="w-3.5 h-3.5 text-emerald-500" />
          <span>Cloud Sync Active</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => syncCloud()}
          className="gap-2 cursor-pointer text-xs text-muted-foreground"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Sync Now</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="gap-2 cursor-pointer text-xs text-destructive focus:text-destructive"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
