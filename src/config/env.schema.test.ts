import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env.schema'

const complete = {
  DATABASE_URL: 'postgres://cv:cv@postgres:5432/cv',
  REDIS_URL: 'redis://redis:6379',
  ANTHROPIC_API_KEY: 'sk-ant-test',
}

describe('parseEnv', () => {
  it('needs only the API key: the URLs default to the compose services on the host', () => {
    const env = parseEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(env.DATABASE_URL).toBe('postgres://cv:cv@127.0.0.1:55432/cv')
    expect(env.REDIS_URL).toBe('redis://127.0.0.1:56379')
  })

  it('fills the defaults: queue prefix, model, concurrency, port, plain info logs, no JWT secret, no API docs', () => {
    expect(parseEnv(complete)).toEqual({
      DATABASE_URL: 'postgres://cv:cv@postgres:5432/cv',
      REDIS_URL: 'redis://redis:6379',
      QUEUE_PREFIX: 'cv',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      WORKER_CONCURRENCY: 8,
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_CONTENT: false,
      LOG_PRETTY: false,
      JWT_SECRET: undefined,
      API_DOCS: false,
    })
  })

  it('turns the API docs on only when API_DOCS says so', () => {
    expect(parseEnv({ ...complete, API_DOCS: 'true' }).API_DOCS).toBe(true)
    expect(parseEnv({ ...complete, API_DOCS: 'false' }).API_DOCS).toBe(false)
    expect(() => parseEnv({ ...complete, API_DOCS: 'maybe' })).toThrow(/API_DOCS/)
  })

  it('logs content and pretty lines only when asked', () => {
    const env = parseEnv({
      ...complete,
      LOG_CONTENT: 'true',
      LOG_PRETTY: 'true',
      LOG_LEVEL: 'trace',
    })
    expect(env).toMatchObject({ LOG_CONTENT: true, LOG_PRETTY: true, LOG_LEVEL: 'trace' })
    expect(() => parseEnv({ ...complete, LOG_CONTENT: 'yes please' })).toThrow(/LOG_CONTENT/)
  })

  it('reads numbers from strings and keeps the overrides', () => {
    const env = parseEnv({
      ...complete,
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      WORKER_CONCURRENCY: '2',
      PORT: '4000',
      JWT_SECRET: 'a'.repeat(32),
      LOG_LEVEL: 'silent',
    })
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-5-5')
    expect(env.WORKER_CONCURRENCY).toBe(2)
    expect(env.PORT).toBe(4000)
    expect(env.JWT_SECRET).toBe('a'.repeat(32))
    expect(env.LOG_LEVEL).toBe('silent')
  })

  it('names a missing variable', () => {
    const { ANTHROPIC_API_KEY: _, ...withoutKey } = complete
    expect(() => parseEnv(withoutKey)).toThrow(EnvError)
    expect(() => parseEnv(withoutKey)).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('names a malformed variable and keeps its message to the variable', () => {
    expect(() => parseEnv({ ...complete, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/)
    expect(() => parseEnv({ ...complete, WORKER_CONCURRENCY: 'many' })).toThrow(
      /WORKER_CONCURRENCY/,
    )
  })

  it('lists every bad variable at once', () => {
    let message = ''
    try {
      parseEnv({ DATABASE_URL: 'nope', REDIS_URL: 'nope' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/REDIS_URL/)
    expect(message).toMatch(/ANTHROPIC_API_KEY/)
  })
})
