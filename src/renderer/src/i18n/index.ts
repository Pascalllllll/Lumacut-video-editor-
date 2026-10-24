import en from './en.json'

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

export type MessageKey = Leaves<typeof en>

function lookup(key: string): string {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node)
      node = (node as Record<string, unknown>)[part]
    else return key
  }
  return typeof node === 'string' ? node : key
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const message = lookup(key)
  if (!vars) return message
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

/**
 * For keys built at runtime (effect types, blend modes). Every prefix used
 * this way is checked against en.json by the i18n test.
 */
export function td(key: string, vars?: Record<string, string | number>): string {
  return t(key as MessageKey, vars)
}
