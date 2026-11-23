import { describe, expect, it } from 'vitest'
import { parseAccountList, parseAccountsJson, resolveAccountSeeds } from '../src/accounts.js'

describe('account configuration', () => {
  it('parses list, JSON and legacy single-account forms', () => {
    expect(parseAccountList('a@example.com:first-password,b@example.com:second-password')).toEqual([
      { account: 'a@example.com', password: 'first-password' },
      { account: 'b@example.com', password: 'second-password' },
    ])
    // Newlines and blank entries are tolerated; only the first colon separates.
    expect(parseAccountList(' a@example.com:pa:ss \n\nb@example.com:second-password ')).toEqual([
      { account: 'a@example.com', password: 'pa:ss' },
      { account: 'b@example.com', password: 'second-password' },
    ])
    expect(parseAccountList('')).toEqual([])
    expect(parseAccountList(undefined)).toEqual([])
    expect(parseAccountsJson('[{"account":"a@example.com","password":"first-password"}]'))
      .toEqual([{ account: 'a@example.com', password: 'first-password' }])
    expect(resolveAccountSeeds({ account: ' owner@example.com ', password: 'local-test-password' }))
      .toEqual([{ account: 'owner@example.com', password: 'local-test-password' }])
    expect(resolveAccountSeeds({
      accounts: [
        { account: 'a@example.com', password: 'first-password' },
        { account: ' b@example.com ', password: 'second-password' },
      ],
    })).toEqual([
      { account: 'a@example.com', password: 'first-password' },
      { account: 'b@example.com', password: 'second-password' },
    ])
  })

  it('rejects ambiguous, incomplete, short-password and duplicate configurations', () => {
    expect(() => resolveAccountSeeds({})).toThrow(/At least one account/)
    expect(() => resolveAccountSeeds({
      accounts: [{ account: 'a@example.com', password: 'first-password' }],
      account: 'b@example.com',
      password: 'second-password',
    })).toThrow(/not both/)
    expect(() => resolveAccountSeeds({ account: 'a@example.com', password: '' })).toThrow(/at least 12/)
    expect(() => resolveAccountSeeds({ accounts: [{ account: ' ', password: 'first-password' }] })).toThrow(/1-254/)
    expect(() => resolveAccountSeeds({ accounts: [{ account: 'a@example.com', password: 'too-short' }] }))
      .toThrow(/at least 12/)
    expect(() => resolveAccountSeeds({
      accounts: [
        { account: 'a@example.com', password: 'first-password' },
        { account: ' a@example.com ', password: 'second-password' },
      ],
    })).toThrow(/Duplicate/)
  })

  it('rejects list entries without an account separator', () => {
    expect(() => parseAccountList('missing-separator')).toThrow(/expected account:password/)
    expect(() => parseAccountList(':no-account')).toThrow(/expected account:password/)
  })
})
