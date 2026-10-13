'use client'

import { saveRecentGroup } from '@/app/groups/recent-groups-helpers'
import { useAuth } from '@/app/auth-provider'
import { useEffect } from 'react'
import { useCurrentGroup } from './current-group-context'

export function SaveGroupLocally() {
  const { group } = useCurrentGroup()
  const { user, syncCloud } = useAuth()

  useEffect(() => {
    if (group) {
      saveRecentGroup({ id: group.id, name: group.name })
      if (user) {
        syncCloud()
      }
    }
  }, [group, user, syncCloud])

  return null
}
