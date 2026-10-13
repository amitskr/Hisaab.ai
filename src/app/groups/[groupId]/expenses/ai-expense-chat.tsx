'use client'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { RecurrenceRule } from '@/generated/prisma/browser'
import { randomId } from '@/lib/random'
import { ExpenseFormInput, ExpenseFormValues } from '@/lib/schemas'
import { amountAsMinorUnits, formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { AppRouterOutput } from '@/trpc/routers/_app'
import {
  Bot,
  Calendar,
  CheckCircle2,
  Edit3,
  Key,
  Loader2,
  Send,
  Sparkles,
  User,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import {
  ExtractedExpenseData,
  parseExpenseFromNaturalLanguage,
} from './ai-expense-actions'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  expense?: ExtractedExpenseData | null
  usedEngine?: 'openai' | 'local'
}

export function AiExpenseChat({
  group,
  categories,
  activeUserId,
  onApplyToManual,
  onSubmitExpense,
  onSwitchToManual,
}: {
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  categories: AppRouterOutput['categories']['list']['categories']
  activeUserId?: string
  onApplyToManual: (values: Partial<ExpenseFormInput>) => void
  onSubmitExpense: (values: ExpenseFormValues, participantId?: string) => Promise<void>
  onSwitchToManual: () => void
}) {
  const t = useTranslations('ExpenseForm')
  const groupCurrency = getCurrencyFromGroup(group)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [submittingExpense, setSubmittingExpense] = useState(false)
  const [customApiKey, setCustomApiKey] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load custom API key from localStorage if saved
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey = localStorage.getItem('spliit-custom-openai-key')
      if (savedKey) setCustomApiKey(savedKey)
    }
  }, [])

  const handleSaveApiKey = (key: string) => {
    setCustomApiKey(key)
    if (typeof window !== 'undefined') {
      if (key) {
        localStorage.setItem('spliit-custom-openai-key', key)
      } else {
        localStorage.removeItem('spliit-custom-openai-key')
      }
    }
    setIsSettingsOpen(false)
  }

  // Initial welcome message
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: t('AiChat.welcomeMessage'),
      expense: null,
    },
  ])

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Dynamic suggestion chips based on group members
  const participants = group.participants
  const p1 = participants[0]?.name || 'Alice'
  const p2 = participants[1]?.name || 'Bob'
  const p3 = participants[2]?.name || 'Charlie'

  const sampleSuggestions = [
    `${p1} paid ${group.currency}60 for dinner yesterday, split equally between all`,
    `${p2} paid ${group.currency}45 for groceries, split between ${p1} and ${p2}`,
    `${p3} paid ${group.currency}30 for taxi to the station, split with everyone`,
  ]

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim()
    if (!text || loading) return

    const userMsg: ChatMessage = {
      id: `user-${randomId()}`,
      role: 'user',
      content: text,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const result = await parseExpenseFromNaturalLanguage({
        message: text,
        history: historyPayload,
        group: {
          id: group.id,
          name: group.name,
          currency: group.currency,
          currencyCode: group.currencyCode,
          participants: group.participants.map((p) => ({
            id: p.id,
            name: p.name,
          })),
        },
        categories: categories.map((c) => ({
          id: c.id,
          grouping: c.grouping,
          name: c.name,
        })),
        activeUserId,
        userOpenAiKey: customApiKey || undefined,
      })

      const assistantMsg: ChatMessage = {
        id: `assistant-${randomId()}`,
        role: 'assistant',
        content: result.reply,
        expense: result.extractedExpense,
        usedEngine: result.usedEngine,
      }

      setMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      console.error(err)
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${randomId()}`,
          role: 'assistant',
          content:
            "Sorry, I had trouble processing that request. Please try again or switch to the manual form.",
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleCreateExpenseDirectly = async (data: ExtractedExpenseData) => {
    try {
      setSubmittingExpense(true)

      // Convert to ExpenseFormValues
      const formValues: ExpenseFormValues = {
        title: data.title,
        expenseDate: new Date(data.expenseDate),
        amount: amountAsMinorUnits(data.amount, groupCurrency),
        category: data.categoryId,
        paidBy: data.paidBy,
        splitMode: data.splitMode,
        paidFor: data.paidFor.map(({ participant, shares }) => ({
          participant,
          shares:
            data.splitMode === 'BY_AMOUNT'
              ? amountAsMinorUnits(Number(shares) || 0, groupCurrency)
              : typeof shares === 'string'
                ? Math.round(Number(shares) * 100)
                : shares,
        })),
        saveDefaultSplittingOptions: false,
        isReimbursement: false,
        documents: [],
        notes: data.notes || '',
        recurrenceRule: RecurrenceRule.NONE,
      }

      await onSubmitExpense(formValues, activeUserId)
    } finally {
      setSubmittingExpense(false)
    }
  }

  const handleEditInManualForm = (data: ExtractedExpenseData) => {
    // In manual form, amounts are in major units (react-hook-form format)
    onApplyToManual({
      title: data.title,
      expenseDate: new Date(data.expenseDate),
      amount: data.amount,
      category: data.categoryId,
      paidBy: data.paidBy,
      splitMode: data.splitMode,
      paidFor: data.paidFor.map((p) => ({
        participant: p.participant,
        shares: p.shares,
      })),
      notes: data.notes || '',
    })
  }

  return (
    <Card className="flex flex-col border shadow-sm rounded-xl overflow-hidden min-h-[180px] sm:h-[700px] sm:max-h-[85vh]">
      {/* Chat Header */}
      <CardHeader className="p-3 sm:p-5 border-b flex flex-row items-center justify-between space-y-0 bg-muted/20">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm sm:text-lg">
                {t('AiChat.title')}
              </CardTitle>
              <Badge variant="secondary" className="text-[10px] sm:text-xs font-normal py-0">
                AI Mode
              </Badge>
            </div>
            <CardDescription className="text-xs sm:text-sm hidden sm:block">
              {t('AiChat.subtitle')}
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* OpenAI Key Configuration Popover */}
          <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title={t('AiChat.settings')}
              >
                <Key className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-4">
              <div className="space-y-3">
                <div className="font-semibold text-sm">
                  {t('AiChat.settings')}
                </div>
                <p className="text-xs text-muted-foreground">
                  The assistant uses smart natural language parsing by default. You can optionally supply your own OpenAI API key.
                </p>
                <Input
                  type="password"
                  placeholder={t('AiChat.apiKeyPlaceholder')}
                  defaultValue={customApiKey}
                  id="openai-key-input"
                  className="text-xs"
                />
                <div className="flex justify-between items-center pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => {
                      const inputEl = document.getElementById(
                        'openai-key-input',
                      ) as HTMLInputElement
                      if (inputEl) inputEl.value = ''
                      handleSaveApiKey('')
                    }}
                  >
                    {t('AiChat.clearKey')}
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const inputEl = document.getElementById(
                        'openai-key-input',
                      ) as HTMLInputElement
                      handleSaveApiKey(inputEl?.value || '')
                    }}
                  >
                    Save Key
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Quick link to manual mode */}
          <Button
            variant="outline"
            size="sm"
            onClick={onSwitchToManual}
            className="text-xs gap-1 hidden sm:flex"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Manual Form</span>
          </Button>
        </div>
      </CardHeader>

      {/* Messages Scroll Area */}
      <CardContent className="overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4 max-h-[50vh] sm:max-h-none sm:flex-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`flex gap-2 sm:gap-3 max-w-[95%] sm:max-w-[85%] ${
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary mt-0.5">
                  <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
              ) : (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 text-secondary-foreground mt-0.5">
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
              )}

              <div className="space-y-2.5 sm:space-y-3 flex-1">
                <div
                  className={`rounded-2xl px-3.5 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted/70 text-foreground border rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>

                {/* Parsed Expense Interactive Card */}
                {msg.expense && (
                  <ExpensePreviewCard
                    expense={msg.expense}
                    group={group}
                    categories={categories}
                    onCreate={() => handleCreateExpenseDirectly(msg.expense!)}
                    onEdit={() => handleEditInManualForm(msg.expense!)}
                    isSubmitting={submittingExpense}
                  />
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
              <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="bg-muted/70 border rounded-2xl rounded-tl-sm px-3.5 py-2 sm:px-4 sm:py-3 flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-primary" />
              <span>{t('AiChat.thinking')}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </CardContent>

      {/* Suggestion Chips - horizontal swipeable on mobile */}
      {messages.length <= 2 && !loading && (
        <div className="px-3 sm:px-4 py-1.5 sm:py-2 border-t bg-muted/10">
          <div className="text-[11px] sm:text-xs text-muted-foreground mb-1 flex items-center gap-1 font-medium">
            <Sparkles className="w-3 h-3 text-primary" />
            <span>{t('AiChat.suggestionsTitle')}</span>
          </div>
          <div className="flex sm:flex-wrap gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {sampleSuggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSendMessage(suggestion)}
                className="text-[11px] sm:text-xs whitespace-nowrap bg-background hover:bg-muted border rounded-full px-2.5 py-1 transition-colors text-muted-foreground hover:text-foreground shrink-0"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Box Footer */}
      <div className="p-2.5 sm:p-4 border-t bg-background">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="flex gap-2 items-end"
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder={t('AiChat.inputPlaceholder')}
            rows={1}
            className="resize-none min-h-[42px] sm:min-h-[50px] max-h-[120px] text-xs sm:text-sm py-2.5 px-3"
            disabled={loading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || loading}
            className="h-[42px] w-[42px] sm:h-[50px] sm:w-[50px] shrink-0"
            title={t('AiChat.send')}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </Card>
  )
}

/**
 * Interactive Preview Card rendered inside the chat when an expense is recognized.
 */
function ExpensePreviewCard({
  expense,
  group,
  categories,
  onCreate,
  onEdit,
  isSubmitting,
}: {
  expense: ExtractedExpenseData
  group: NonNullable<AppRouterOutput['groups']['get']['group']>
  categories: AppRouterOutput['categories']['list']['categories']
  onCreate: () => void
  onEdit: () => void
  isSubmitting: boolean
}) {
  const t = useTranslations('ExpenseForm')
  const locale = useLocale()
  const groupCurrency = getCurrencyFromGroup(group)

  const category = categories.find((c) => c.id === expense.categoryId) || null
  const payer = group.participants.find((p) => p.id === expense.paidBy)
  const payerName = payer?.name || 'Unknown'

  // Format participant shares
  const participantsCount = expense.paidFor.length
  const totalAmount = expense.amount

  return (
    <div className="border border-border/80 bg-card rounded-xl p-4 shadow-sm space-y-3.5 transition-all">
      <div className="flex items-center justify-between border-b pb-2.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="font-semibold text-sm">
            {t('AiChat.previewTitle')}
          </span>
        </div>
        <div className="text-lg font-bold text-primary">
          {formatCurrency(groupCurrency, totalAmount, locale, true)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <span className="text-muted-foreground block">
            {t('AiChat.titleLabel')}
          </span>
          <span className="font-medium text-foreground">{expense.title}</span>
        </div>

        <div>
          <span className="text-muted-foreground block">
            {t('AiChat.categoryLabel')}
          </span>
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            {category && <CategoryIcon category={category} className="w-3.5 h-3.5" />}
            <span>{category?.name || 'General'}</span>
          </div>
        </div>

        <div>
          <span className="text-muted-foreground block">
            {t('AiChat.paidByLabel')}
          </span>
          <span className="font-medium text-foreground">{payerName}</span>
        </div>

        <div>
          <span className="text-muted-foreground block">
            {t('AiChat.dateLabel')}
          </span>
          <div className="flex items-center gap-1 font-medium text-foreground">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{expense.expenseDate}</span>
          </div>
        </div>
      </div>

      {/* Split details */}
      <div className="border-t pt-2 text-xs">
        <span className="text-muted-foreground block mb-1">
          {t('AiChat.splitLabel')}
        </span>
        <div className="bg-muted/40 rounded-lg p-2 flex flex-col gap-1">
          {expense.splitMode === 'EVENLY' ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Equally between {participantsCount} member(s):
              </span>
              <span className="font-medium">
                {formatCurrency(
                  groupCurrency,
                  totalAmount / participantsCount,
                  locale,
                  true,
                )}{' '}
                each
              </span>
            </div>
          ) : (
            expense.paidFor.map(({ participant: pId, shares }) => {
              const p = group.participants.find((part) => part.id === pId)
              return (
                <div key={pId} className="flex justify-between items-center">
                  <span>{p?.name || 'Participant'}</span>
                  <span className="font-medium">
                    {formatCurrency(groupCurrency, Number(shares) || 0, locale, true)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 gap-1.5 font-medium"
          onClick={onCreate}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t('creating')}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('AiChat.createExpense')}</span>
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onEdit}
          disabled={isSubmitting}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>{t('AiChat.editInForm')}</span>
        </Button>
      </div>
    </div>
  )
}
