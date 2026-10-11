let input = ''
for await (const chunk of process.stdin) input += chunk

let payload
try {
  payload = JSON.parse(input)
} catch (error) {
  console.error(`test-scope hook could not parse Claude's input: ${error.message}`)
  process.exit(2)
}

const command = payload?.tool_input?.command
if (typeof command !== 'string') process.exit(0)

const runsFullSuite = command.split(/&&|\|\||;/).some((segment) => {
  let part = segment.trim()
  if (!part || /(?:^|\s)ALLOW_FULL_TEST_SUITE=1(?:\s|$)/.test(part)) return false

  part = part.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/, '')
  if (/(?:^|\s)--check(?:\s|$)/.test(part)) return false

  return /^(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?test|npx\s+platformkit\s+test|platformkit\s+test|node\s+(?:\S*\/)?packages\/kit\/build\/test\.mjs)(?:\s|$)/.test(part)
})

if (runsFullSuite) {
  console.error(
    'Blocked full-suite test run. Use targeted verification by default. ' +
    'If James explicitly requests the full suite, prefix it with ALLOW_FULL_TEST_SUITE=1.'
  )
  process.exit(2)
}
