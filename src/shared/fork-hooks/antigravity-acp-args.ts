// fork: extra argv for the managed Antigravity ACP server. Unregistered, launches keep upstream's.

let extra: readonly string[] = []

export function registerAntigravityAcpLinuxArgs(args: readonly string[]): void {
  extra = args
}

/** Spread beside the Linux `--uid=` argument. Empty until the fork registers. */
export function antigravityAcpLinuxArgs(): readonly string[] {
  return extra
}
