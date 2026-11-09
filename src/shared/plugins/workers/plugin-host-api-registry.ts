import type { PluginSurface } from '../frames/plugin-protocol'
import type { PluginHostMethodSpec } from './plugin-host-method-spec'

// fork.* 由桌面主进程和插件 worker 登记。静态表不 import src/fork，打包 CLI 才不会引用 out/fork。
const registeredPluginHostMethods = new Map<string, PluginHostMethodSpec>()

export function registerPluginHostApiMethods(
  methods: Readonly<Record<string, PluginHostMethodSpec>>,
  upstreamNames: readonly string[]
): void {
  const upstream = new Set(upstreamNames)
  for (const [name, method] of Object.entries(methods)) {
    const existing = registeredPluginHostMethods.get(name)
    if (existing === method) {
      continue
    }
    if (existing !== undefined || upstream.has(name)) {
      throw new Error(`plugin host method ${name} is already registered`)
    }
    registeredPluginHostMethods.set(name, method)
  }
}

export function extraHostMethod(name: string): PluginHostMethodSpec | null {
  return registeredPluginHostMethods.get(name) ?? null
}

export function hostMethodsFor<Name extends string>(
  surface: PluginSurface,
  names: readonly Name[],
  surfacesOf: (name: Name) => readonly PluginSurface[]
): Name[] {
  const listed: string[] = names.filter((name) => surfacesOf(name).includes(surface))
  for (const [name, method] of registeredPluginHostMethods) {
    if (method.surfaces.includes(surface) && !listed.includes(name)) {
      listed.push(name)
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: registered fork names are not in the upstream union; callers only use them as method name strings.
  return listed as Name[]
}
