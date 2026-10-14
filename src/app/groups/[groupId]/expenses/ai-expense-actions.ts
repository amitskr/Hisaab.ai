'use server'

import { env } from '@/lib/env'
import { getOpenAIClient } from '@/lib/openai'
import { formatCategoryForAIPrompt } from '@/lib/utils'
import { z } from 'zod'

export type ExtractedExpenseData = {
  title: string
  amount: number
  expenseDate: string // YYYY-MM-DD
  categoryId: number
  paidBy: string // participant ID
  splitMode: 'EVENLY' | 'BY_AMOUNT' | 'BY_PERCENTAGE' | 'BY_SHARES'
  paidFor: Array<{
    participant: string
    shares: string
  }>
  notes?: string
}

export type ParseExpenseResult = {
  reply: string
  extractedExpense: ExtractedExpenseData | null
  confidence: 'high' | 'partial' | 'none'
  usedEngine: 'openai' | 'local'
}

export type ParticipantInfo = {
  id: string
  name: string
}

export type CategoryInfo = {
  id: number
  grouping: string
  name: string
}

export type GroupContext = {
  id: string
  name: string
  currency: string
  currencyCode?: string | null
  participants: ParticipantInfo[]
}

export type ChatMessageInput = {
  role: 'user' | 'assistant'
  content: string
}

const aiResponseSchema = z.object({
  reply: z.string(),
  hasExpense: z.boolean(),
  title: z.string().optional(),
  amount: z.number().optional(),
  expenseDate: z.string().optional(),
  categoryId: z.number().optional(),
  paidBy: z.string().optional(),
  splitMode: z
    .enum(['EVENLY', 'BY_AMOUNT', 'BY_PERCENTAGE', 'BY_SHARES'])
    .optional(),
  paidFor: z
    .array(
      z.object({
        participant: z.string(),
        shares: z.string(),
      }),
    )
    .optional(),
  notes: z.string().optional(),
})

/**
 * Format today's date as YYYY-MM-DD
 */
function getTodayString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Fallback / Local NLP parser that executes when OpenAI is unavailable or fails.
 * Understands amounts, payers, participants, categories, dates, and split modes.
 */
export async function parseExpenseWithLocalNLP(
  message: string,
  group: GroupContext,
  categories: CategoryInfo[],
  activeUserId?: string,
  history?: ChatMessageInput[],
): Promise<ParseExpenseResult> {
  const text = message.trim()
  const lower = text.toLowerCase()

  // 1. Amount extraction
  // Handles: $50, 50$, 50.25, 50 usd, 50 euros, 50€, £50, Rs 50, etc.
  let amount: number | null = null
  const amountMatch = lower.match(
    /(?:[$€£₹]\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:[$€£₹]|usd|eur|gbp|inr|dollars|bucks|euros|rupees)|for\s+(\d+(?:[.,]\d{1,2})?)|cost\s+(\d+(?:[.,]\d{1,2})?)|amount\s+(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?))/i,
  )

  if (amountMatch) {
    const rawNumber =
      amountMatch[1] ??
      amountMatch[2] ??
      amountMatch[3] ??
      amountMatch[4] ??
      amountMatch[5] ??
      amountMatch[6]
    if (rawNumber) {
      const parsed = parseFloat(rawNumber.replace(',', '.'))
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed
      }
    }
  }

  // 2. Date extraction
  let expenseDate = getTodayString()
  if (lower.includes('yesterday')) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    expenseDate = d.toISOString().split('T')[0]
  } else if (lower.includes('day before yesterday')) {
    const d = new Date()
    d.setDate(d.getDate() - 2)
    expenseDate = d.toISOString().split('T')[0]
  } else if (lower.includes('tomorrow')) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    expenseDate = d.toISOString().split('T')[0]
  } else {
    // Check for explicit YYYY-MM-DD or DD/MM/YYYY
    const isoDateMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
    if (isoDateMatch) {
      expenseDate = isoDateMatch[0]
    }
  }

  // 3. Payer ("paidBy") extraction
  let paidBy: string | null = null
  const participants = group.participants

  // Check if "I paid" / "paid by me" / "my expense"
  if (
    activeUserId &&
    (lower.includes('i paid') ||
      lower.includes('paid by me') ||
      lower.includes('my expense') ||
      lower.includes('i bought'))
  ) {
    paidBy = activeUserId
  }

  // Match against participant names
  if (!paidBy) {
    for (const p of participants) {
      const pName = p.name.toLowerCase()
      const payerPatterns = [
        new RegExp(`\\b${pName}\\s+paid\\b`, 'i'),
        new RegExp(`paid\\s+by\\s+${pName}\\b`, 'i'),
        new RegExp(`\\b${pName}\\s+bought\\b`, 'i'),
        new RegExp(`bought\\s+by\\s+${pName}\\b`, 'i'),
        new RegExp(`\\b${pName}\\s+covered\\b`, 'i'),
      ]
      if (payerPatterns.some((pattern) => pattern.test(lower))) {
        paidBy = p.id
        break
      }
    }
  }

  // If still not found, check if a participant name appears at the start (e.g. "Alice $50 for dinner")
  if (!paidBy) {
    for (const p of participants) {
      const pName = p.name.toLowerCase()
      if (lower.startsWith(pName) || lower.includes(pName)) {
        paidBy = p.id
        break
      }
    }
  }

  // Default to active user or first participant
  if (!paidBy) {
    paidBy = activeUserId || participants[0]?.id || ''
  }

  // 4. Split participants & Split mode
  let splitMode: 'EVENLY' | 'BY_AMOUNT' | 'BY_PERCENTAGE' | 'BY_SHARES' =
    'EVENLY'
  const paidForList: Array<{ participant: string; shares: string }> = []

  // Check for custom amount splits: e.g. "Alice owes 20 and Bob owes 10" or "Alice 20, Bob 30"
  const customAmounts: Record<string, number> = {}
  for (const p of participants) {
    const pName = p.name.toLowerCase()
    const customMatch = text.match(
      new RegExp(
        `(?:${pName}\\s*(?:owes|gets|pays|takes|has)?\\s*[:=-]?\\s*[$€£₹]?\\s*(\\d+(?:[.,]\\d{1,2})?))`,
        'i',
      ),
    )
    if (customMatch && customMatch[1]) {
      customAmounts[p.id] = parseFloat(customMatch[1].replace(',', '.'))
    }
  }

  if (Object.keys(customAmounts).length >= 2) {
    splitMode = 'BY_AMOUNT'
    for (const [pId, shareAmt] of Object.entries(customAmounts)) {
      paidForList.push({
        participant: pId,
        shares: String(shareAmt),
      })
    }
  } else {
    // Check which participants are included
    const mentionedParticipants: string[] = []
    if (
      lower.includes('all') ||
      lower.includes('everyone') ||
      lower.includes('everybody')
    ) {
      mentionedParticipants.push(...participants.map((p) => p.id))
    } else {
      for (const p of participants) {
        const pName = p.name.toLowerCase()
        if (
          lower.includes(`between ${pName}`) ||
          lower.includes(`with ${pName}`) ||
          lower.includes(`and ${pName}`) ||
          lower.includes(pName)
        ) {
          mentionedParticipants.push(p.id)
        }
      }
    }

    const uniqueSelected = Array.from(new Set(mentionedParticipants))
    const finalSelected =
      uniqueSelected.length > 0
        ? uniqueSelected
        : participants.map((p) => p.id)

    for (const pId of finalSelected) {
      paidForList.push({
        participant: pId,
        shares: '1',
      })
    }
  }

  // 5. Category extraction
  let categoryId = 0 // default General
  const categoryKeywords: Record<string, number> = {
    dinner: 8,
    lunch: 8,
    breakfast: 8,
    restaurant: 8,
    cafe: 8,
    coffee: 8,
    food: 7,
    groceries: 9,
    supermarket: 9,
    beer: 10,
    drinks: 10,
    liquor: 10,
    wine: 10,
    taxi: 35,
    cab: 35,
    uber: 35,
    lyft: 35,
    flight: 34,
    plane: 34,
    train: 29,
    bus: 29,
    subway: 29,
    hotel: 32,
    airbnb: 32,
    stay: 32,
    movie: 4,
    cinema: 4,
    games: 3,
    music: 5,
    concert: 5,
    sports: 6,
    cleaning: 37,
    electricity: 38,
    wifi: 41,
    internet: 41,
    water: 42,
    rent: 11,
    furniture: 13,
    doctor: 25,
    pharmacy: 25,
    medicine: 25,
    donation: 43,
  }

  for (const [kw, catId] of Object.entries(categoryKeywords)) {
    if (lower.includes(kw)) {
      // Ensure the category actually exists in the categories list
      if (categories.some((c) => c.id === catId)) {
        categoryId = catId
        break
      }
    }
  }

  // 6. Title extraction
  let title = 'Expense'
  let cleaned = text
    // Remove split clauses (e.g. ", split equally between Alice and Bob", "split with everyone")
    .replace(/\b(?:,\s*)?split\s+(?:equally|evenly)?\s*(?:between|with|among)?.*$/i, '')
    // Remove owes clauses (e.g. ", Bob owes 30 and Alice owes 15")
    .replace(/\b(?:,\s*)?[a-zA-Z0-9_-]+\s*(?:owes|pays|gets)\b.*$/i, '')
    // Remove payer patterns
    .replace(/(?:i paid|paid by me|paid by [a-z0-9_-]+|[a-z0-9_-]+ paid)/gi, '')
    // Remove amount patterns
    .replace(/[$€£₹]\s*\d+(?:[.,]\d{1,2})?/gi, '')
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:usd|eur|gbp|inr|dollars|bucks|euros|rupees)\b/gi, '')
    // Remove date references
    .replace(/\b(?:day before yesterday|yesterday|today|tomorrow)\b/gi, '')
    // Remove leading prepositions like "for ", "on ", "at "
    .replace(/^\s*(?:for|on|at)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Clean non-alphanumeric punctuation from borders
  cleaned = cleaned.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim()
  if (cleaned.length >= 2) {
    title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  } else {
    const cat = categories.find((c) => c.id === categoryId)
    title = cat && cat.id !== 0 ? cat.name : 'Expense'
  }

  if (!amount) {
    return {
      reply: `I noticed you're talking about an expense for "${title}", but I couldn't clearly find the amount. Could you mention how much it was (for example: "$45 for ${title}")?`,
      extractedExpense: null,
      confidence: 'partial',
      usedEngine: 'local',
    }
  }

  const payerObj = participants.find((p) => p.id === paidBy)
  const payerName = payerObj?.name ?? 'Someone'
  const count = paidForList.length
  const splitText =
    splitMode === 'BY_AMOUNT'
      ? 'custom amounts'
      : count === participants.length
        ? `everyone equally (${group.currency}${(amount / count).toFixed(2)} each)`
        : `${count} people equally (${group.currency}${(amount / count).toFixed(2)} each)`

  const reply = `I've prepared the expense for **${title}** (${group.currency}${amount.toFixed(
    2,
  )}). Paid by **${payerName}**, split between ${splitText}.`

  return {
    reply,
    extractedExpense: {
      title,
      amount,
      expenseDate,
      categoryId,
      paidBy,
      splitMode,
      paidFor: paidForList,
    },
    confidence: 'high',
    usedEngine: 'local',
  }
}

/**
 * Main server action to parse an expense from natural language input.
 * Tries OpenAI first if configured, falls back to the intelligent local engine.
 */
export async function parseExpenseFromNaturalLanguage({
  message,
  history = [],
  group,
  categories,
  activeUserId,
  userOpenAiKey,
}: {
  message: string
  history?: ChatMessageInput[]
  group: GroupContext
  categories: CategoryInfo[]
  activeUserId?: string
  userOpenAiKey?: string
}): Promise<ParseExpenseResult> {
  const apiKey = userOpenAiKey || env.OPENAI_API_KEY

  if (apiKey) {
    try {
      const openai = getOpenAIClient()
      const activeUser = group.participants.find((p) => p.id === activeUserId)
      const today = getTodayString()

      const promptContext = `
You are the AI Expense Assistant for HisaaabAI, an intelligent group expense splitting application.
Today's date is: ${today}.
Group Name: "${group.name}".
Group Currency: "${group.currency}" (code: ${group.currencyCode || 'N/A'}).
Active User (the person typing right now): ${
        activeUser
          ? `Name: "${activeUser.name}", ID: "${activeUser.id}"`
          : 'Unknown'
      }.

Group Participants (use ONLY these IDs for paidBy and paidFor):
${group.participants.map((p) => `- Name: "${p.name}", ID: "${p.id}"`).join('\n')}

Available Categories (select the most appropriate category ID):
${categories.map((c) => formatCategoryForAIPrompt(c)).join('\n')}

Instructions:
1. Parse the user's message to understand the expense.
2. Determine:
   - "title": A concise descriptive title (e.g. "Dinner", "Groceries", "Uber to airport").
   - "amount": Total expense amount as a positive number (in standard currency units, e.g. 50.00).
   - "expenseDate": Date in YYYY-MM-DD format. Resolve relative expressions ("yesterday", "last Friday") relative to ${today}.
   - "categoryId": Category ID from the list above. Default to 0 ("General") if uncertain.
   - "paidBy": Participant ID of who paid. If user says "I", "me", "my", use Active User ID (${
     activeUserId || group.participants[0]?.id
   }).
   - "splitMode": One of "EVENLY", "BY_AMOUNT", "BY_PERCENTAGE", "BY_SHARES". Default to "EVENLY".
   - "paidFor": Array of objects: { "participant": "<participant_id>", "shares": "<share_value>" }.
     - For "EVENLY": set "shares" to "1" for each participating member.
     - For "BY_AMOUNT": set "shares" to the exact amount string for each participant (must sum to total amount).
     - If the user says "split with everyone" or does not specify who, include ALL group participants.
   - "hasExpense": Set to true if an expense was recognized, false if the user is just asking a question or greeting.
   - "reply": Friendly conversational response explaining what was understood and asking for clarification if any key detail (amount, payer) is missing.
`

      const messages: Array<{
        role: 'system' | 'user' | 'assistant'
        content: string
      }> = [
        { role: 'system', content: promptContext },
        ...history.slice(-6).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        { role: 'user', content: message },
      ]

      const completion = await openai.chat.completions.create({
        model: env.OPENAI_MODEL_EXPENSE_CHAT || 'gpt-4o-mini',
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'expense_extraction',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                reply: { type: 'string' },
                hasExpense: { type: 'boolean' },
                title: { type: 'string' },
                amount: { type: 'number' },
                expenseDate: { type: 'string' },
                categoryId: { type: 'integer' },
                paidBy: { type: 'string' },
                splitMode: {
                  type: 'string',
                  enum: ['EVENLY', 'BY_AMOUNT', 'BY_PERCENTAGE', 'BY_SHARES'],
                },
                paidFor: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      participant: { type: 'string' },
                      shares: { type: 'string' },
                    },
                    required: ['participant', 'shares'],
                    additionalProperties: false,
                  },
                },
                notes: { type: 'string' },
              },
              required: [
                'reply',
                'hasExpense',
                'title',
                'amount',
                'expenseDate',
                'categoryId',
                'paidBy',
                'splitMode',
                'paidFor',
                'notes',
              ],
              additionalProperties: false,
            },
          },
        },
      })

      const content = completion.choices.at(0)?.message.content
      if (content) {
        const parsed = aiResponseSchema.parse(JSON.parse(content))

        if (parsed.hasExpense && parsed.amount && parsed.title && parsed.paidBy) {
          // Validate participant IDs exist
          const validParticipantIds = new Set(
            group.participants.map((p) => p.id),
          )
          const validPaidBy = validParticipantIds.has(parsed.paidBy)
            ? parsed.paidBy
            : group.participants[0]?.id || ''

          const validPaidFor = (parsed.paidFor || []).filter((p) =>
            validParticipantIds.has(p.participant),
          )

          const finalPaidFor =
            validPaidFor.length > 0
              ? validPaidFor
              : group.participants.map((p) => ({
                  participant: p.id,
                  shares: '1',
                }))

          return {
            reply: parsed.reply,
            extractedExpense: {
              title: parsed.title,
              amount: parsed.amount,
              expenseDate: parsed.expenseDate || today,
              categoryId: parsed.categoryId ?? 0,
              paidBy: validPaidBy,
              splitMode: parsed.splitMode || 'EVENLY',
              paidFor: finalPaidFor,
              notes: parsed.notes,
            },
            confidence: 'high',
            usedEngine: 'openai',
          }
        } else {
          return {
            reply:
              parsed.reply ||
              "I'm here to help split expenses! Tell me who paid, the amount, and who to split it with.",
            extractedExpense: null,
            confidence: parsed.hasExpense ? 'partial' : 'none',
            usedEngine: 'openai',
          }
        }
      }
    } catch (err) {
      console.warn('OpenAI expense extraction failed, falling back to local NLP:', err)
      // Fall through to local parser
    }
  }

  // Fallback to local heuristic parser
  return parseExpenseWithLocalNLP(
    message,
    group,
    categories,
    activeUserId,
    history,
  )
}
