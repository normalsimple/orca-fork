import { ChevronRight, ChevronsDownUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { normalizeExecutionHostScope, type ExecutionHostScope } from '../../shared/execution-host'
import type { AiVaultSessionGroup } from '../../shared/ai-vault/session-display/ai-vault-session-filters'
import { forkTranslate } from '../i18n/fork-translate'
import { otherVaultHosts, type VaultHostMenu } from './host-menu'
import { aiVaultHostRowsRegistered, readAiVaultHostSessionCount } from './list-presentation'

export function AiVaultCollapseAllButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-6"
      aria-label={forkTranslate('fork.aiVault.collapseAll', 'Collapse all groups')}
      onClick={onClick}
    >
      <ChevronsDownUp className="size-3" />
    </Button>
  )
}

/** Registered builds draw history group headers with {@link ForkVaultGroupHeader}. */
export function forkVaultGroupHeaders(): boolean {
  return aiVaultHostRowsRegistered()
}

/** Upstream's VaultGroupHeader, except long directory titles wrap and host rows count their sessions. */
export function ForkVaultGroupHeader({
  group,
  collapsed,
  onToggle
}: {
  group: AiVaultSessionGroup
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex min-h-8 w-full items-center gap-2 border-y border-sidebar-border bg-sidebar-accent/60 px-3 py-1.5 text-left text-xs font-semibold text-foreground transition-colors hover:bg-sidebar-accent"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 text-foreground/80 transition-transform',
          !collapsed && 'rotate-90'
        )}
      />
      <span className="min-w-0 flex-1 break-all">{group.label}</span>
      <span className="rounded-md border border-sidebar-border bg-background px-2 py-0.5 text-[11px] font-semibold tabular-nums leading-none text-foreground shadow-xs">
        {readAiVaultHostSessionCount(group) ?? group.sessions.length}
      </span>
    </button>
  )
}

/** The hosts the panel's menu list leaves out, in a submenu. Null when there are none. */
export function forkOtherVaultHostsMenu(
  menu: VaultHostMenu,
  scope: ExecutionHostScope,
  onChange: (scope: ExecutionHostScope) => void
): React.JSX.Element | null {
  const others = otherVaultHosts(menu)
  if (others.length === 0) {
    return null
  }
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {forkTranslate('fork.aiVault.otherHosts', 'Other configured hosts')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={scope}
            onValueChange={(value) => onChange(normalizeExecutionHostScope(value))}
          >
            {others.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
