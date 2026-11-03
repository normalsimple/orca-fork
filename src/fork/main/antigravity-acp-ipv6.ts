// 1.4.1 的 agy_acp_server.par 在 google3 初始化时强制创建 AF_INET6 socket。
// 内核 CONFIG_IPV6=n（关掉 IPv6 的容器常见）会在这里 SIGABRT，安装校验和正式会话都起不来。
// 二进制自己提示可以用这个参数跳过检查。不改主机网络，也不把 pin 升到会往工作区写 skill 的版本。

/** 关掉 google3 对内核 IPv6 的强制检查。 */
export const ANTIGRAVITY_ACP_SKIP_KERNEL_IPV6_ARG = '--enforce_kernel_ipv6_support=false'

/** 只在 Linux 追加上述参数。其他平台的启动参数保持上游。 */
export function antigravityAcpIpv6BypassArgs(): readonly string[] {
  return process.platform === 'linux' ? [ANTIGRAVITY_ACP_SKIP_KERNEL_IPV6_ARG] : []
}
