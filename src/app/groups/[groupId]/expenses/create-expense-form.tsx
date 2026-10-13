'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { useActiveUser } from '@/lib/hooks'
import { randomId } from '@/lib/random'
import { ExpenseFormInput, ExpenseFormValues } from '@/lib/schemas'
import { trpc } from '@/trpc/client'
import { Edit3, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AiExpenseChat } from './ai-expense-chat'
import { ExpenseForm } from './expense-form'

export function CreateExpenseForm({
  groupId,
  runtimeFeatureFlags,
}: {
  groupId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const t = useTranslations('ExpenseForm')
  const searchParams = useSearchParams()
  const activeUserId = useActiveUser(groupId)

  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { mutateAsync: createExpenseMutateAsync } =
    trpc.groups.expenses.create.useMutation()

  // Minted here rather than on save: the id seeds which participant takes the
  // leftover minor unit of an uneven split (see `getExpenseShares`), so the
  // form needs it to preview the split the expense will actually be saved
  // with. Per mount, so a fresh visit to the page gets a fresh id.
  const [expenseId, setExpenseId] = useState(() => randomId())
  const [draftExpense, setDraftExpense] =
    useState<Partial<ExpenseFormInput> | null>(null)

  // Mode state: 'ai' or 'manual'
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')

  useEffect(() => {
    // If opened with specific parameters (like reimbursement or receipt image), default to manual
    const hasSpecificParams =
      Boolean(searchParams.get('reimbursement')) ||
      Boolean(searchParams.get('imageUrl')) ||
      Boolean(searchParams.get('amount'))

    if (hasSpecificParams) {
      setMode('manual')
      return
    }

    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('spliit-expense-input-mode')
      if (savedMode === 'manual' || savedMode === 'ai') {
        setMode(savedMode)
      }
    }
  }, [searchParams])

  const handleModeChange = (newMode: 'ai' | 'manual') => {
    setMode(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('spliit-expense-input-mode', newMode)
    }
  }

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !categories) return null

  const handleCreateExpense = async (
    expenseFormValues: ExpenseFormValues,
    participantId?: string,
  ) => {
    try {
      await createExpenseMutateAsync({
        groupId,
        expenseFormValues,
        participantId: participantId || activeUserId || undefined,
        expenseId,
      })
    } catch (error) {
      // The server may have created the expense and only the response
      // been lost; retrying with the same id would then collide with it
      // rather than create anything.
      setExpenseId(randomId())
      throw error
    }
    utils.groups.expenses.invalidate()
    utils.groups.stats.invalidate()
    router.push(`/groups/${group.id}`)
  }

  return (
    <div className="space-y-2.5 sm:space-y-4">
      {/* Greeting and Dual-Mode Toggle */}
      <div className="space-y-2 sm:space-y-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight">
            {t('ModeSelector.greeting')}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
            {t('ModeSelector.description')}
          </p>
        </div>

        <Tabs
          value={mode}
          onValueChange={(val) => handleModeChange(val as 'ai' | 'manual')}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2 h-9 sm:h-11 p-0.5 sm:p-1 bg-muted/60">
            <TabsTrigger
              value="ai"
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
              <span>{t('ModeSelector.aiMode')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Edit3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
              <span>{t('ModeSelector.manualMode')}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Render AI Chat or Manual Form */}
      {mode === 'ai' ? (
        <AiExpenseChat
          group={group}
          categories={categories}
          activeUserId={activeUserId || undefined}
          onApplyToManual={(extractedDraft) => {
            setDraftExpense(extractedDraft)
            handleModeChange('manual')
          }}
          onSubmitExpense={handleCreateExpense}
          onSwitchToManual={() => handleModeChange('manual')}
        />
      ) : (
        <ExpenseForm
          group={group}
          categories={categories}
          expenseId={expenseId}
          initialValues={draftExpense ?? undefined}
          onSwitchToAi={() => handleModeChange('ai')}
          onSubmit={handleCreateExpense}
          runtimeFeatureFlags={runtimeFeatureFlags}
        />
      )}
    </div>
  )
}
