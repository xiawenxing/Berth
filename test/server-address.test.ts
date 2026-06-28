import { describe, it, expect } from 'vitest'
import { setLocalServerAddress, getLocalServerAddress } from '../src/server/server-address'

describe('server-address', () => {
  it('records and returns the running server address', () => {
    expect(getLocalServerAddress()).toBeNull()
    setLocalServerAddress(7777, '127.0.0.1')
    expect(getLocalServerAddress()).toEqual({ port: 7777, host: '127.0.0.1' })
  })
})
