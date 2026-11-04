import { afterEach, describe, expect, it } from 'vitest'
import { ALL_EXECUTION_HOSTS_SCOPE, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  registerAiVaultDefaultHostScope,
  resetAiVaultForkHooksForTests
} from '../../shared/fork-hooks/ai-vault'
import { resolveAiVaultHostScopeDefaults } from '../../renderer/src/components/right-sidebar/ai-vault/scope/ai-vault-host-scope'

afterEach(() => {
  resetAiVaultForkHooksForTests()
})

describe('history host menu default', () => {
  it('uses every host once the fork default is registered', () => {
    registerAiVaultDefaultHostScope(ALL_EXECUTION_HOSTS_SCOPE)
    expect(
      resolveAiVaultHostScopeDefaults(LOCAL_EXECUTION_HOST_ID, 'workspace-1')
        .defaultExecutionHostScope
    ).toBe(ALL_EXECUTION_HOSTS_SCOPE)
  })

  it('keeps the workspace host when nothing is registered', () => {
    expect(
      resolveAiVaultHostScopeDefaults(LOCAL_EXECUTION_HOST_ID, 'workspace-1')
        .defaultExecutionHostScope
    ).toBe(LOCAL_EXECUTION_HOST_ID)
  })
})
