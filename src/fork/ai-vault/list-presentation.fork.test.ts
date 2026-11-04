import { afterEach, describe, expect, it } from 'vitest'
import { folderLabel } from '../../shared/ai-vault/session-display/ai-vault-session-filters'
import {
  getLocalExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { resetAiVaultForkHooksForTests } from '../../shared/fork-hooks/ai-vault'
import {
  hostHeaderKey,
  partitionAiVaultGroupsByHost,
  readAiVaultHostSessionCount,
  registerAiVaultListPresentation,
  visibleAiVaultGroups
} from './list-presentation'

afterEach(() => {
  resetAiVaultForkHooksForTests()
})

type ListGroup = {
  key: string
  label: string | null
  sessions: { executionHostId: ExecutionHostId }[]
}

const linuxBox = toRuntimeExecutionHostId('0b9d2c4e-runtime-env')

describe('history list presentation', () => {
  it('keeps the full directory and splits one folder across hosts under host rows', () => {
    registerAiVaultListPresentation()
    expect(folderLabel('/srv/wt/project/app')).toBe('/srv/wt/project/app')

    const groups = partitionAiVaultGroupsByHost(
      [
        {
          key: 'folder:/srv/wt/project/app',
          label: '/srv/wt/project/app',
          sessions: [
            { executionHostId: LOCAL_EXECUTION_HOST_ID },
            { executionHostId: linuxBox },
            { executionHostId: linuxBox }
          ]
        }
      ],
      (hostId) => (hostId === linuxBox ? 'build-linux' : getLocalExecutionHostLabel())
    )
    expect(groups.map((group) => group.label)).toEqual([
      getLocalExecutionHostLabel(),
      '/srv/wt/project/app',
      'build-linux',
      '/srv/wt/project/app'
    ])

    const visible = visibleAiVaultGroups(groups, new Set([hostHeaderKey(linuxBox)]))
    expect(visible.map((group) => group.label)).toEqual([
      getLocalExecutionHostLabel(),
      '/srv/wt/project/app',
      'build-linux'
    ])
    // Host rows list no rows of their own but still show how many sessions they hold.
    expect(visible.map((group) => group.sessions.length)).toEqual([0, 1, 0])
    expect(visible.map(readAiVaultHostSessionCount)).toEqual([1, undefined, 2])
  })

  it('leaves search hits flat and omits the host row for one host', () => {
    const search: ListGroup[] = [
      {
        key: 'search-results',
        label: null,
        sessions: [{ executionHostId: LOCAL_EXECUTION_HOST_ID }, { executionHostId: linuxBox }]
      }
    ]
    expect(partitionAiVaultGroupsByHost(search)).toBe(search)

    // One host has no host row, but its directory keys carry the host like they do under one.
    const single = partitionAiVaultGroupsByHost([
      {
        key: 'folder:/srv/wt/project/app',
        label: '/srv/wt/project/app',
        sessions: [{ executionHostId: linuxBox }]
      }
    ])
    expect(single.map((group) => [group.key, group.label])).toEqual([
      [`${linuxBox}::folder:/srv/wt/project/app`, '/srv/wt/project/app']
    ])
  })

  it('keeps the short folder label until presentation is registered', () => {
    expect(folderLabel('/srv/wt/project/app')).toBe('project/app')
  })
})
