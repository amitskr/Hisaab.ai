import {
  parseExpenseFromNaturalLanguage,
  parseExpenseWithLocalNLP,
} from './ai-expense-actions'

var mockCreate = jest.fn()

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = {
      completions: { create: (...args: unknown[]) => mockCreate(...args) },
    }
  },
}))

jest.mock('../../../../lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_BASE_URL: undefined,
    OPENAI_MODEL_EXPENSE_CHAT: 'gpt-4o-mini',
  },
}))

const sampleGroup = {
  id: 'group-1',
  name: 'Trip to Paris',
  currency: '$',
  currencyCode: 'USD',
  participants: [
    { id: 'user-1', name: 'Alice' },
    { id: 'user-2', name: 'Bob' },
    { id: 'user-3', name: 'Charlie' },
  ],
}

const sampleCategories = [
  { id: 0, grouping: 'Uncategorized', name: 'General' },
  { id: 8, grouping: 'Food and Drink', name: 'Dining Out' },
  { id: 9, grouping: 'Food and Drink', name: 'Groceries' },
  { id: 35, grouping: 'Transportation', name: 'Taxi' },
]

describe('parseExpenseWithLocalNLP', () => {
  it('correctly parses an equal split expense with amount and payer', async () => {
    const result = await parseExpenseWithLocalNLP(
      'Alice paid $60 for dinner, split equally between Alice, Bob and Charlie',
      sampleGroup,
      sampleCategories,
      'user-1',
    )

    expect(result.extractedExpense).not.toBeNull()
    expect(result.extractedExpense?.amount).toBe(60)
    expect(result.extractedExpense?.paidBy).toBe('user-1')
    expect(result.extractedExpense?.categoryId).toBe(8) // Dining Out
    expect(result.extractedExpense?.splitMode).toBe('EVENLY')
    expect(result.extractedExpense?.paidFor).toHaveLength(3)
  })

  it('correctly resolves "I paid" to active user', async () => {
    const result = await parseExpenseWithLocalNLP(
      'I paid $35 for groceries yesterday',
      sampleGroup,
      sampleCategories,
      'user-2', // Bob is active
    )

    expect(result.extractedExpense).not.toBeNull()
    expect(result.extractedExpense?.amount).toBe(35)
    expect(result.extractedExpense?.paidBy).toBe('user-2')
    expect(result.extractedExpense?.categoryId).toBe(9) // Groceries
  })

  it('handles missing amount gracefully', async () => {
    const result = await parseExpenseWithLocalNLP(
      'Dinner with friends',
      sampleGroup,
      sampleCategories,
    )

    expect(result.extractedExpense).toBeNull()
    expect(result.confidence).toBe('partial')
    expect(result.reply).toContain("couldn't clearly find the amount")
  })
})

describe('parseExpenseFromNaturalLanguage', () => {
  beforeEach(() => mockCreate.mockReset())

  it('uses OpenAI structured response when available', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              reply: 'Got it! Taxi ride for $25 paid by Bob.',
              hasExpense: true,
              title: 'Taxi to airport',
              amount: 25,
              expenseDate: '2026-10-14',
              categoryId: 35,
              paidBy: 'user-2',
              splitMode: 'EVENLY',
              paidFor: [
                { participant: 'user-1', shares: '1' },
                { participant: 'user-2', shares: '1' },
              ],
              notes: '',
            }),
          },
        },
      ],
    })

    const result = await parseExpenseFromNaturalLanguage({
      message: 'Bob paid $25 for taxi to airport split with Alice',
      group: sampleGroup,
      categories: sampleCategories,
      activeUserId: 'user-1',
    })

    expect(result.usedEngine).toBe('openai')
    expect(result.extractedExpense?.title).toBe('Taxi to airport')
    expect(result.extractedExpense?.amount).toBe(25)
    expect(result.extractedExpense?.paidBy).toBe('user-2')
    expect(result.extractedExpense?.paidFor).toHaveLength(2)
  })

  it('falls back to local NLP when OpenAI throws an error', async () => {
    mockCreate.mockRejectedValue(new Error('OpenAI API rate limit exceeded'))

    const result = await parseExpenseFromNaturalLanguage({
      message: 'Alice paid $45 for groceries',
      group: sampleGroup,
      categories: sampleCategories,
      activeUserId: 'user-1',
    })

    expect(result.usedEngine).toBe('local')
    expect(result.extractedExpense?.amount).toBe(45)
    expect(result.extractedExpense?.paidBy).toBe('user-1')
  })
})
