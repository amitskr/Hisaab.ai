import { Button } from '@/components/ui/button'
// lucide-react v1 dropped its brand icons, so the GitHub mark comes from Radix.
import { TrackPage } from '@/lib/analytics/track-page'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

// FIX for https://github.com/vercel/next.js/issues/58615
// export const dynamic = 'force-dynamic'

export default function HomePage() {
  const t = useTranslations()
  return (
    <main className="flex-1 flex flex-col justify-center items-center px-4 py-6 sm:py-8">
      <TrackPage path="/" />
      <div className="container flex max-w-screen-md flex-col items-center gap-3 sm:gap-5 text-center my-auto">
        <h1 className="!leading-tight font-extrabold text-3xl sm:text-4xl md:text-5xl lg:text-6xl landing-header py-1">
          {t.rich('Homepage.title', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </h1>
        <p className="max-w-[38rem] leading-normal text-muted-foreground text-sm sm:text-base md:text-lg">
          {t.rich('Homepage.description', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <div className="flex gap-3 pt-2">
          <Button asChild size="default" className="shadow-sm">
            <Link href="/groups">{t('Homepage.button.groups')}</Link>
          </Button>
          <Button asChild variant="secondary" size="default">
            <Link
              href="https://github.com/amitskr/Hisaab.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubLogoIcon className="w-4 h-4 mr-2" />
              {t('Homepage.button.github')}
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
