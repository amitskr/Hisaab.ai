'use client'

import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { GoogleIcon } from '@/components/user-nav'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { useState } from 'react'

export function HomeGoogleAuth() {
  const { user, loading, loginWithGoogle } = useAuth()
  const [imageError, setImageError] = useState(false)

  if (loading) {
    return <div className="h-9 my-1" />
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-1.5 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={loginWithGoogle}
          className="h-9 px-4 gap-2 text-xs sm:text-sm font-medium bg-white/80 dark:bg-card/80 border-border/80 hover:bg-muted shadow-xs rounded-full transition-all"
        >
          <GoogleIcon className="w-4 h-4 shrink-0" />
          <span>Sign in with Google</span>
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Optional · Sync your groups automatically across devices
        </p>
      </div>
    )
  }

  const initial = user.name
    ? user.name.charAt(0).toUpperCase()
    : user.email.charAt(0).toUpperCase()

  return (
    <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 px-3.5 py-1.5 rounded-full shadow-2xs">
      {user.image && !imageError ? (
        <Image
          src={user.image}
          alt={user.name || 'User'}
          width={20}
          height={20}
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className="rounded-full ring-1 ring-border object-cover"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
          {initial}
        </div>
      )}
      <span className="font-medium text-foreground text-xs truncate max-w-[150px] sm:max-w-[200px]">
        {user.name || user.email}
      </span>
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
        <Check className="w-3 h-3" /> Synced
      </span>
    </div>
  )
}
