'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Footer() {
  const pathname = usePathname()

  // Do not show footer on the AI chat / expense creation page
  if (pathname?.includes('/expenses/create')) {
    return null
  }

  return (
    <footer className="sm:p-8 md:p-16 sm:mt-16 sm:text-sm md:text-base md:mt-32 bg-slate-50 dark:bg-card border-t p-6 mt-8 flex flex-col sm:flex-row sm:justify-between gap-4 text-xs">
      <div className="flex flex-col space-y-2">
        <div className="sm:text-lg font-semibold text-base flex space-x-2 items-center">
          <Link className="flex items-center gap-2.5 hover:opacity-90 transition-opacity" href="/">
            <Image
              src="/icon.png"
              className="rounded-xl shadow-sm"
              width={28}
              height={28}
              alt="Hisaab.ai"
            />
            <span className="font-bold text-lg tracking-tight text-foreground flex items-center">
              Hisaab<span className="text-emerald-500">.ai</span>
            </span>
          </Link>
        </div>
        <div className="flex flex-col space-y-1 text-muted-foreground text-xs sm:text-sm">
          <span>Made by Amit Sarkar</span>
          <span>
            On top of{' '}
            <a
              href="https://github.com/spliit-app/spliit"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-foreground hover:text-primary transition-colors font-medium"
            >
              Spliit
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
