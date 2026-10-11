export function portRequest(args, name, defaultValue) {
  const inlineAuto = `${name}:auto`
  if (args.includes(inlineAuto)) return { auto: true, port: null }
  const index = args.indexOf(name)
  const value = index >= 0 && args[index + 1] ? args[index + 1] : String(defaultValue)
  if (value === 'auto') return { auto: true, port: null }
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535, or auto`)
  }
  return { auto: false, port }
}

export async function resolvePort(args, name, defaultValue, { available, findFree, autoStart = defaultValue } = {}) {
  const request = portRequest(args, name, defaultValue)
  if (request.auto) return findFree(autoStart)
  if (!await available(request.port)) {
    throw new Error(`${name} ${request.port} is unavailable; choose another port or pass ${name}:auto`)
  }
  return request.port
}
