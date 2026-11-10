// 登记主机目录卡片的名字规则（F054），以及标题后面淡色的分支。
import { TruncatedSidebarLabel } from '@/components/sidebar/truncated-sidebar-label'
import { registerWorktreeCardIdentity } from '../../shared/fork-hooks/sidebar-card-identity'
import { singleCheckoutCardIdentity, singleCheckoutCardTemplate } from './single-checkout-card'

export function registerCardIdentity(): void {
  registerWorktreeCardIdentity({
    resolve: singleCheckoutCardIdentity,
    transformTemplate: singleCheckoutCardTemplate,
    // 和目录前缀一样最多占一行的 45%，标题优先保留。
    renderTrailingBranch: (branch, tooltip) => (
      <TruncatedSidebarLabel
        text={branch}
        className="max-w-[45%] shrink text-xs text-muted-foreground"
        tooltipEnabled={tooltip}
      />
    )
  })
}
