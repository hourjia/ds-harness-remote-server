import { readFileSync } from 'node:fs'
import { z } from 'zod'

/** One account accepted by the Server. Passwords stay in memory only as scrypt verifiers. */
export interface AccountSeed {
  account: string
  password: string
}

const accountSeedSchema = z.object({
  account: z.string(),
  password: z.string(),
}).strict()

/**
 * Parse `account:password` entries separated by commas or newlines (the
 * `DSH_SERVER_ACCOUNTS` format). The first colon separates the account from the
 * password, so passwords may contain colons but not commas or newlines. Use
 * `DSH_SERVER_ACCOUNTS_FILE` for passwords that need those characters.
 */
export function parseAccountList(value: string | undefined): AccountSeed[] {
  if (!value) return []
  return value
    .split(/[\n,]/u)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => {
      const separator = entry.indexOf(':')
      if (separator <= 0) throw new Error('Invalid DSH_SERVER_ACCOUNTS entry: expected account:password.')
      return { account: entry.slice(0, separator).trim(), password: entry.slice(separator + 1) }
    })
}

/** Parse the JSON body of `DSH_SERVER_ACCOUNTS_FILE`: `[{"account":"...","password":"..."}]`. */
export function parseAccountsJson(value: string): AccountSeed[] {
  return z.array(accountSeedSchema).parse(JSON.parse(value))
}

export function parseAccountsFile(file: string): AccountSeed[] {
  return parseAccountsJson(readFileSync(file, 'utf8'))
}

/**
 * Normalize every configuration path into one validated seed list.
 *
 * `accounts` (from `DSH_SERVER_ACCOUNTS` and/or `DSH_SERVER_ACCOUNTS_FILE`) and
 * the legacy single-account pair `account`/`password` are mutually exclusive:
 * mixing them makes it ambiguous which deployment shape the operator intended.
 * Empty strings are treated as missing so a compose file can pass unset
 * variables through as `""`.
 */
export function resolveAccountSeeds(source: {
  accounts?: readonly AccountSeed[]
  account?: string
  password?: string
}): AccountSeed[] {
  const seeds = [...(source.accounts ?? [])]
  // `password` alone is still a configuration attempt: report a clear error
  // instead of silently starting without the account the operator meant to set.
  const legacy = source.account !== undefined || source.password !== undefined
  if (legacy) {
    if (seeds.length > 0) throw new Error('Configure either DSH_SERVER_ACCOUNTS or DSH_SERVER_ACCOUNT/DSH_SERVER_PASSWORD, not both.')
    seeds.push({ account: source.account ?? '', password: source.password ?? '' })
  }
  if (seeds.length === 0) throw new Error('At least one account is required: set DSH_SERVER_ACCOUNTS or DSH_SERVER_ACCOUNT/DSH_SERVER_PASSWORD.')
  const seen = new Set<string>()
  return seeds.map(seed => {
    const account = seed.account.trim()
    if (account.length === 0 || account.length > 254) throw new Error('Each configured account must be 1-254 characters.')
    if (seed.password.length < 12) throw new Error('Each configured account password must be at least 12 characters.')
    if (seen.has(account)) throw new Error('Duplicate configured accounts are not allowed.')
    seen.add(account)
    return { account, password: seed.password }
  })
}
