import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { searchMessageRows } from '../../../main/ai-vault-search/session-search-message-rows'
import {
  openSessionSearchDatabase,
  SESSION_SEARCH_SCHEMA_VERSION
} from '../../../main/ai-vault-search/session-search-schema'
import {
  readAiVaultServiceHeapMiB,
  registerAiVaultServiceHeap,
  registerAiVaultToolIndexPolicy,
  resetAiVaultForkHooksForTests
} from '../../../shared/fork-hooks/ai-vault'
import { aiVaultServiceHeapMiB } from './heap'
import { applyAiVaultForkServicePolicy, aiVaultForkServicePolicy } from './service-policy'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

afterEach(() => {
  resetAiVaultForkHooksForTests()
})

describe('scan policy', () => {
  it('sizes the service heap from installed memory', () => {
    expect(aiVaultServiceHeapMiB(2 * GIB)).toBe(384)
    expect(aiVaultServiceHeapMiB(4 * GIB)).toBe(1024)
    expect(aiVaultServiceHeapMiB(16 * GIB)).toBe(2048)
    // The spawn passes upstream's 384 as the fallback; only a registered resolver changes it.
    expect(readAiVaultServiceHeapMiB(384)).toBe(384)
    registerAiVaultServiceHeap(() => aiVaultServiceHeapMiB(16 * GIB))
    expect(readAiVaultServiceHeapMiB(384)).toBe(2048)
  })

  it('indexes a whole tool result in chunks and bumps the schema', async () => {
    const text = `${'alpha '.repeat(4000)}tail`
    // 未登记时跟上游：工具输出不进索引。
    expect([...searchMessageRows([{ role: 'tool', text, timestamp: null }])]).toEqual([])

    applyAiVaultForkServicePolicy(aiVaultForkServicePolicy())
    const rows = [...searchMessageRows([{ role: 'tool', text, timestamp: null }])]
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.map((row) => row.text).join('')).toBe(text)

    const root = await mkdtemp(join(tmpdir(), 'orca-vault-schema-'))
    try {
      const db = openSessionSearchDatabase(join(root, 'index.sqlite'))
      const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
      const value =
        version && typeof version === 'object' && 'value' in version ? version.value : undefined
      // fork 偏移 1：旧库里的工具输出是截断的，打开时要丢掉重建。
      expect(value).toBe(String(SESSION_SEARCH_SCHEMA_VERSION + 1))
      db.close()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('drops tool output when the fork chunk policy is off', () => {
    registerAiVaultToolIndexPolicy('capped')
    const rows = [...searchMessageRows([{ role: 'tool', text: 'x'.repeat(9000), timestamp: null }])]
    expect(rows).toEqual([])
  })
})
