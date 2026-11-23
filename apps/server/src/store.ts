import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { accountDeviceDescriptorSchema, type AccountDeviceDescriptor } from '@dsh-remote/protocol'
import { z } from 'zod'
import type { AccountSeed } from './accounts.js'

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
export const secret = (): string => randomBytes(32).toString('base64url')
export const equal = (left: string, right: string): boolean => timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)))

export type { AccountSeed }

/** Per-account device quota; a single deployment-wide cap still applies below. */
export const MAX_DEVICES_PER_ACCOUNT = 128
export const MAX_DEVICES_TOTAL = 4096
export const MAX_TOKENS_TOTAL = 65536
/** Burned for an unknown account so login timing cannot confirm account existence. */
const DUMMY_SALT = 'dsh-remote-unknown-account-v1'

const tokenSchema = z.object({
  kind: z.enum(['access', 'refresh']), deviceId: z.string(), expires: z.number(), used: z.boolean(),
  recovery: z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), accessExpires: z.number().int().positive() }).optional(),
})
const accountRecordSchema = z.object({
  salt: z.string(),
  verifier: z.string(),
  createdAt: z.number(),
  disabled: z.boolean(),
})
const savedDeviceSchema = z.object({
  owner: z.string(),
  descriptor: accountDeviceDescriptorSchema,
  revoked: z.boolean(),
  lastSeenAt: z.number(),
})
/** v1 kept one account for the whole file and no owner on devices. */
const legacyDeviceSchema = z.object({
  descriptor: accountDeviceDescriptorSchema,
  revoked: z.boolean(),
  lastSeenAt: z.number(),
})
const legacyStateSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  salt: z.string(),
  verifier: z.string(),
  devices: z.record(z.string(), legacyDeviceSchema),
  tokens: z.record(z.string(), tokenSchema),
})
const stateSchema = z.object({
  version: z.literal(2),
  accounts: z.record(z.string(), accountRecordSchema),
  devices: z.record(z.string(), savedDeviceSchema),
  tokens: z.record(z.string(), tokenSchema),
})
type State = z.infer<typeof stateSchema>
export type SavedDevice = z.infer<typeof savedDeviceSchema>
type SavedToken = z.infer<typeof tokenSchema>

// Domain-separated HMACs keyed by the presented bearer, NOT its stored digest.
// The nonce alone cannot recover credentials from a copy of state.json.
function successor(token: string, nonce: string, deviceId: string) {
  const derive = (kind: string) => createHmac('sha256', token)
    .update(JSON.stringify(['ds-harness-remote/refresh/v1', deviceId, nonce, kind])).digest('base64url')
  return { accessToken: derive('access'), refreshToken: derive('refresh') }
}

/**
 * Single-process, multi-account store. Only token digests, account verifiers
 * (scrypt over a per-account salt) and public identities reach disk.
 *
 * Access boundaries are implicit but strict: a Client may only see and connect
 * to Hosts whose `owner` equals its own. Accounts absent from the startup
 * configuration are disabled, and their tokens are revoked, so the environment
 * remains the single source of truth for who may sign in.
 */
export class Store {
  private state: State
  onInvalidate: (id: string) => void = () => {}
  constructor(private readonly file: string, seeds: readonly AccountSeed[]) {
    if (seeds.length === 0) throw new Error('At least one account is required.')
    this.state = this.read() ?? { version: 2, accounts: {}, devices: {}, tokens: {} }
    this.syncAccounts(seeds)
    this.save()
  }
  private read(): State | undefined {
    if (!existsSync(this.file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1) {
      return this.migrate(legacyStateSchema.parse(parsed))
    }
    return stateSchema.parse(parsed)
  }
  /** v1 → v2: the single account becomes an entry and every device inherits it. */
  private migrate(legacy: z.infer<typeof legacyStateSchema>): State {
    // A v1 process cannot read a v2 file, so keep a rollback copy before the
    // first write. Best effort: a failed backup must not block the migration.
    try {
      if (!existsSync(`${this.file}.v1.bak`)) copyFileSync(this.file, `${this.file}.v1.bak`)
    } catch {
      // Backup is advisory only.
    }
    const devices: State['devices'] = {}
    for (const [id, device] of Object.entries(legacy.devices)) devices[id] = { owner: legacy.account, ...device }
    return {
      version: 2,
      accounts: {
        [legacy.account]: { salt: legacy.salt, verifier: legacy.verifier, createdAt: Date.now(), disabled: false },
      },
      devices,
      tokens: legacy.tokens,
    }
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
  /**
   * Reconcile configured accounts with the persisted file: add new accounts,
   * re-derive verifiers with the stored salt, revoke credentials when an
   * account's password changed, and disable accounts no longer configured.
   */
  private syncAccounts(seeds: readonly AccountSeed[]): void {
    const now = Date.now()
    const configured = new Set<string>()
    for (const seed of seeds) {
      const previous = this.state.accounts[seed.account]
      const salt = previous?.salt ?? secret()
      const verifier = scryptSync(seed.password, salt, 32).toString('hex')
      if (previous && !equal(previous.verifier, verifier)) this.revokeAccountTokens(seed.account)
      this.state.accounts[seed.account] = { salt, verifier, createdAt: previous?.createdAt ?? now, disabled: false }
      configured.add(seed.account)
    }
    for (const [account, record] of Object.entries(this.state.accounts)) {
      if (configured.has(account) || record.disabled) continue
      record.disabled = true
      this.revokeAccountTokens(account)
    }
  }
  /** Drop every token belonging to one account, without touching other accounts. */
  private revokeAccountTokens(account: string): void {
    for (const [key, token] of Object.entries(this.state.tokens)) {
      const device = this.state.devices[token.deviceId]
      if (!device || device.owner === account) delete this.state.tokens[key]
    }
  }
  /**
   * Constant-work credential check: an unknown or disabled account still pays
   * for one scrypt round, so timing cannot be used to enumerate accounts.
   */
  verify(account: string, password: string): boolean {
    const record = this.state.accounts[account]
    if (!record || record.disabled) {
      scryptSync(password, DUMMY_SALT, 32)
      return false
    }
    return equal(record.verifier, scryptSync(password, record.salt, 32).toString('hex'))
  }
  get(id: string): SavedDevice {
    const d = Object.hasOwn(this.state.devices, id) ? this.state.devices[id] : undefined
    if (!d) throw new ApiError('DEVICE_NOT_FOUND', 404)
    if (d.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    const account = this.state.accounts[d.owner]
    if (!account || account.disabled) throw new ApiError('DEVICE_REVOKED', 403)
    return d
  }
  list(owner: string): SavedDevice[] {
    return Object.values(this.state.devices).filter(d => !d.revoked && d.owner === owner)
  }
  register(descriptor: AccountDeviceDescriptor, owner: string): ReturnType<Store['issue']> {
    const account = this.state.accounts[owner]
    if (!account || account.disabled) throw new ApiError('AUTH_INVALID', 401)
    const old = this.state.devices[descriptor.deviceId]
    if (old?.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    // A device identity belongs to exactly one account for its lifetime: a
    // second account re-registering the same deviceId is a conflict, not a
    // transfer.
    if (old && old.owner !== owner) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    if (old && (old.descriptor.identityKey !== descriptor.identityKey || old.descriptor.role !== descriptor.role)) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    if (!old) {
      const owned = Object.values(this.state.devices).filter(d => d.owner === owner).length
      if (owned >= MAX_DEVICES_PER_ACCOUNT || Object.keys(this.state.devices).length >= MAX_DEVICES_TOTAL) throw new ApiError('RATE_LIMITED', 429)
    }
    this.state.devices[descriptor.deviceId] = { owner, descriptor, revoked: false, lastSeenAt: old?.lastSeenAt ?? 0 }
    this.invalidate(descriptor.deviceId)
    return this.issue(descriptor.deviceId)
  }
  private issue(deviceId: string, refreshTokenExpiresAt = Date.now() + 30 * 86400_000, previous?: { token: string; record: SavedToken }) {
    const tokens = { ...this.state.tokens }
    for (const [key, value] of Object.entries(tokens)) if (value.expires <= Date.now()) delete tokens[key]
    if (Object.keys(tokens).length + 2 > MAX_TOKENS_TOTAL) throw new ApiError('RATE_LIMITED', 429)
    const accessTokenExpiresAt = Date.now() + 60 * 60_000
    const nonce = secret()
    const { accessToken, refreshToken } = previous
      ? successor(previous.token, nonce, deviceId)
      : { accessToken: secret(), refreshToken: secret() }
    if (previous) tokens[hash(previous.token)] = {
      ...previous.record, used: true, recovery: { nonce, accessExpires: accessTokenExpiresAt },
    }
    tokens[hash(accessToken)] = { kind: 'access', deviceId, expires: accessTokenExpiresAt, used: false }
    tokens[hash(refreshToken)] = { kind: 'refresh', deviceId, expires: refreshTokenExpiresAt, used: false }
    const before = this.state.tokens
    this.state.tokens = tokens
    // Commit consumption, recovery metadata and the successor together. A failed
    // write must leave the previous token usable both in memory and after restart.
    try { this.save() } catch (error) { this.state.tokens = before; throw error }
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
  }
  authenticate(token: string): SavedDevice {
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'access') throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    return this.get(record.deviceId)
  }
  refresh(deviceId: string, token: string) {
    this.get(deviceId)
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'refresh' || record.deviceId !== deviceId) throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    if (!record.used) return this.issue(deviceId, record.expires, { token, record })
    // Legacy consumed tokens have no recovery record. Reject them without
    // invalidating credentials that may already be in use by this device.
    if (!record.recovery) throw new ApiError('AUTH_INVALID', 401)
    const pair = successor(token, record.recovery.nonce, deviceId)
    const next = this.state.tokens[hash(pair.refreshToken)]
    if (!next || next.kind !== 'refresh' || next.deviceId !== deviceId || next.expires !== record.expires) {
      throw new ApiError('INTERNAL_ERROR', 503)
    }
    if (next.used) throw new ApiError('AUTH_INVALID', 401)
    const access = this.state.tokens[hash(pair.accessToken)]
    if (access ? access.kind !== 'access' || access.deviceId !== deviceId || access.expires !== record.recovery.accessExpires
      : record.recovery.accessExpires > Date.now()) throw new ApiError('INTERNAL_ERROR', 503)
    // Return the original expiry, including an expired access bearer. The
    // recovered, still-valid refresh token can then rotate normally.
    return { ...pair, accessTokenExpiresAt: record.recovery.accessExpires, refreshTokenExpiresAt: next.expires }
  }
  invalidate(deviceId: string): void {
    for (const [key, value] of Object.entries(this.state.tokens)) if (value.deviceId === deviceId) delete this.state.tokens[key]
    this.onInvalidate(deviceId)
    this.save()
  }
  revoke(id: string): void { this.get(id).revoked = true; this.invalidate(id) }
  rename(owner: string, id: string, name: string): void {
    const device = this.get(id)
    if (device.owner !== owner) throw new ApiError('MEMBERSHIP_REQUIRED', 403)
    device.descriptor.name = name
    this.save()
  }
  touch(id: string, clientVersion?: string, harnessVersion?: string): void {
    const d = this.get(id)
    d.lastSeenAt = Date.now()
    if (clientVersion) d.descriptor.clientVersion = clientVersion.slice(0, 64)
    if (d.descriptor.role === 'host' && harnessVersion) d.descriptor.harnessVersion = harnessVersion.slice(0, 64)
    this.save()
  }
}
