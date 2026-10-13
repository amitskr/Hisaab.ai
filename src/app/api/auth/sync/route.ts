import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const syncBodySchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ).optional().default([]),
  starredGroups: z.array(z.string()).optional().default([]),
  archivedGroups: z.array(z.string()).optional().default([]),
})

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ synced: false, message: 'Not logged in' })
  }

  let body: z.infer<typeof syncBodySchema> = { groups: [], starredGroups: [], archivedGroups: [] }
  try {
    const raw = await request.json()
    body = syncBodySchema.parse(raw)
  } catch {
    // If empty or invalid payload, proceed with fetching cloud groups
  }

  try {
    // 1. Upload/merge incoming client groups into database
    for (const g of body.groups) {
      // Check if group exists in database
      const existingGroup = await prisma.group.findUnique({
        where: { id: g.id },
        select: { id: true },
      })
      if (existingGroup) {
        await prisma.userGroup.upsert({
          where: {
            userId_groupId: {
              userId: user.id,
              groupId: g.id,
            },
          },
          update: {
            isStarred: body.starredGroups.includes(g.id),
            isArchived: body.archivedGroups.includes(g.id),
          },
          create: {
            userId: user.id,
            groupId: g.id,
            isStarred: body.starredGroups.includes(g.id),
            isArchived: body.archivedGroups.includes(g.id),
          },
        })
      }
    }

    // 2. Fetch all user groups from database
    const userGroups = await prisma.userGroup.findMany({
      where: { userId: user.id },
      include: {
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const syncedGroups = userGroups.map((ug) => ({
      id: ug.group.id,
      name: ug.group.name,
    }))

    const starredGroups = userGroups
      .filter((ug) => ug.isStarred)
      .map((ug) => ug.groupId)

    const archivedGroups = userGroups
      .filter((ug) => ug.isArchived)
      .map((ug) => ug.groupId)

    return NextResponse.json({
      synced: true,
      groups: syncedGroups,
      starredGroups,
      archivedGroups,
    })
  } catch (err) {
    console.error('Failed to sync user groups:', err)
    return NextResponse.json({ synced: false, error: 'Database sync failed' }, { status: 500 })
  }
}
