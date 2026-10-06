import { Writable } from 'node:stream'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { pinoHttpOptions } from './logger-options'

const ENV = { LOG_LEVEL: 'debug', LOG_CONTENT: false, LOG_PRETTY: false } as const

/** The lines a logger built from the options writes, parsed. */
const linesOf = (
  env: Parameters<typeof pinoHttpOptions>[0],
  log: (logger: pino.Logger) => void,
) => {
  const lines: Array<Record<string, unknown>> = []
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()))
      done()
    },
  })
  const { level, redact } = pinoHttpOptions(env)
  log(pino({ level, redact }, sink))
  return lines
}

/** The level of the line of a `method` request answered with `statusCode`. */
const levelOf = (
  method: string,
  statusCode: number,
  { err, ended = true }: { err?: Error; ended?: boolean } = {},
) =>
  pinoHttpOptions(ENV).customLogLevel?.(
    // only the fields the level depends on: the method, the status, whether the answer was sent
    { method } as never,
    { statusCode, writableEnded: ended } as never,
    err,
  )

describe('pinoHttpOptions', () => {
  it('redacts the content of a line unless LOG_CONTENT is on', () => {
    const log = (logger: pino.Logger) =>
      logger.debug({ cvId: 'cv-1', content: { sourceText: 'Olena Hnatiuk' } }, 'CV created')
    expect(linesOf(ENV, log)[0]).toMatchObject({ cvId: 'cv-1', content: '[redacted]' })
    expect(linesOf({ ...ENV, LOG_CONTENT: true }, log)[0]).toMatchObject({
      content: { sourceText: 'Olena Hnatiuk' },
    })
  })

  it('always redacts the cookie and the authorization header', () => {
    const [line] = linesOf({ ...ENV, LOG_CONTENT: true }, (logger) =>
      logger.info({ req: { headers: { cookie: 'session=abc', authorization: 'Bearer x' } } }),
    )
    expect(line).toMatchObject({
      req: { headers: { cookie: '[redacted]', authorization: '[redacted]' } },
    })
  })

  it('keeps the level it is given', () => {
    expect(linesOf({ ...ENV, LOG_LEVEL: 'info' }, (logger) => logger.debug('hidden'))).toEqual([])
  })

  it('logs a request by its outcome: 5xx error, 4xx or aborted warn, a read debug, else info', () => {
    expect(levelOf('POST', 202)).toBe('info')
    expect(levelOf('DELETE', 204)).toBe('info')
    expect(levelOf('GET', 200)).toBe('debug')
    expect(levelOf('GET', 404)).toBe('warn')
    expect(levelOf('POST', 429)).toBe('warn')
    expect(levelOf('GET', 200, { ended: false })).toBe('warn')
    expect(levelOf('GET', 500)).toBe('error')
    expect(levelOf('POST', 200, { err: new Error('socket hang up') })).toBe('error')
  })

  it('puts the error code the filter answered with on the request line', () => {
    const { customProps } = pinoHttpOptions(ENV)
    if (typeof customProps !== 'function') throw new Error('customProps is a function')
    // the request is not read; the response only for its locals
    const propsOf = (res: object) => customProps({} as never, res as never)
    expect(propsOf({ locals: { errorCode: 'NOT_FOUND' } })).toEqual({ errorCode: 'NOT_FOUND' })
    expect(propsOf({ locals: {} })).toEqual({})
    expect(propsOf({})).toEqual({})
  })

  it('pretty-prints through pino-pretty only when LOG_PRETTY is on', () => {
    expect(pinoHttpOptions(ENV).transport).toBeUndefined()
    expect(pinoHttpOptions({ ...ENV, LOG_PRETTY: true }).transport).toMatchObject({
      target: 'pino-pretty',
    })
  })
})
