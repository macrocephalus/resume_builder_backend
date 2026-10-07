import { Inject, Injectable } from '@nestjs/common'
import type { LanguageModel } from 'ai'
import { PinoLogger } from 'nestjs-pino'
import { wordAnswers } from '../agents/answer/word-answers'
import { FAST_LANGUAGE_MODEL } from '../agents/llm'
import { CONTENT } from '../common/logging/logger-options'
import { safeError } from '../common/logging/safe-error'
import { type CvRow, requireDraft } from '../cvs/cv.mapper'
import { WordingBudgetService } from '../limits/wording-budget.service'
import type { CheckedReply } from './check-replies'
import { type WordedAnswers, acceptWording, answersToWord } from './wording-request'

/** How long one wording call may take; the e2e tests shorten it. */
export const ANSWER_WORDING_TIMEOUT = Symbol('ANSWER_WORDING_TIMEOUT')

/**
 * Answer wording (root `docs/architecture.md` §6.5): one fast-model call for the answers of a
 * batch that become bullets, a sentence or a job, each result checked before it is used. Never
 * fails a batch: past the user's budget, when the call fails or a result can't be trusted, those
 * answers go in as written.
 */
@Injectable()
export class AnswerWordingService {
  constructor(
    @Inject(FAST_LANGUAGE_MODEL) private readonly model: LanguageModel,
    @Inject(ANSWER_WORDING_TIMEOUT) private readonly timeoutMs: number,
    private readonly budget: WordingBudgetService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AnswerWordingService.name)
  }

  async word(cv: CvRow, replies: readonly CheckedReply[]): Promise<WordedAnswers> {
    const wordable = answersToWord(requireDraft(cv), replies)
    if (wordable.length === 0) return new Map()
    try {
      const granted = await this.budget.take(cv.userId, wordable.length)
      if (granted < wordable.length) {
        this.logger.info(
          { cvId: cv.id, wordable: wordable.length, sent: granted },
          'wording budget used up; answers inserted as written',
        )
      }
      const toWord = wordable.slice(0, granted)
      if (toWord.length === 0) return new Map()
      const startedAt = Date.now()
      const worded = await wordAnswers(
        this.model,
        {
          language: cv.language,
          targetRole: cv.targetRole,
          answers: toWord,
        },
        this.timeoutMs,
      )
      const { accepted, refused } = acceptWording(toWord, worded, cv.sourceText)
      const log = { cvId: cv.id, worded: accepted.size, durationMs: Date.now() - startedAt }
      if (refused.length > 0) {
        this.logger.warn(
          {
            ...log,
            refused: refused.map(({ questionId, reason }) => ({ questionId, reason })),
            [CONTENT]: { refused, worded },
          },
          'answers not worded; inserted as written',
        )
      } else {
        this.logger.info({ ...log, [CONTENT]: { worded } }, 'answers worded')
      }
      return accepted
    } catch (err) {
      this.logger.warn(
        { cvId: cv.id, answers: wordable.length, err: safeError(err) },
        'answer wording failed; inserted as written',
      )
      return new Map()
    }
  }
}
