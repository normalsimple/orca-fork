// fork: F046. HTML another workspace holds stays in the clicked workspace as a host grant,
// so the doc preview does not activate the owner. Other files are upstream's. Unregistered, so is HTML.
import type { RuntimeClientTarget } from '../runtime-client-target'
import type { RuntimeTerminalPathResolution } from '../runtime-file-contracts'

/** Same shape as the renderer's granted host file, so callers treat it like any other grant. */
export type KeptHostFile = {
  kind: 'grant'
  absolutePath: string
  grantId: string
  isDirectory: false
  readOnly: boolean
}

export type KeptHostFileSource = {
  target: RuntimeClientTarget
  worktreeId: string | null | undefined
}

type KeepHtmlInClickedWorkspace = (
  source: KeptHostFileSource,
  resolved: RuntimeTerminalPathResolution
) => Promise<KeptHostFile | null>

let keepHtml: KeepHtmlInClickedWorkspace | null = null

export function registerKeptHostFileViews(next: KeepHtmlInClickedWorkspace): void {
  keepHtml = next
}

/**
 * HTML another workspace holds: a grant keeps the preview in the clicked one.
 * Null when unregistered, so the caller does not await.
 */
export function keepHostFileInClickedWorkspace(
  source: KeptHostFileSource,
  resolved: RuntimeTerminalPathResolution
): Promise<KeptHostFile | null> | null {
  return keepHtml ? keepHtml(source, resolved) : null
}
