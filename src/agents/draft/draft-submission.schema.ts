import {
  CV_LIMITS,
  CV_SECTIONS,
  certificationItemSchema,
  cvDataSchema,
  educationItemSchema,
  experienceItemSchema,
  languageItemSchema,
  projectItemSchema,
  requirementSchema,
} from '@cv/shared'
import { z } from 'zod'

/** What the model may send: the caps the backend keeps (backend architecture §3). */
export const SUBMISSION_LIMITS = {
  questions: 7,
  requirements: 12,
  suggestedRoles: 3,
  evidence: 200,
  options: 8,
} as const

const { shape } = cvDataSchema

/** `CvData` without item ids: the backend gives every item a UUID. */
export const draftWithoutIdsSchema = z.object({
  contacts: shape.contacts,
  summary: shape.summary,
  experience: z.array(experienceItemSchema.omit({ id: true })).max(CV_LIMITS.experience),
  projects: z.array(projectItemSchema.omit({ id: true })).max(CV_LIMITS.projects),
  education: z.array(educationItemSchema.omit({ id: true })).max(CV_LIMITS.education),
  certifications: z.array(certificationItemSchema.omit({ id: true })).max(CV_LIMITS.certifications),
  skills: shape.skills,
  languages: z.array(languageItemSchema.omit({ id: true })).max(CV_LIMITS.languages),
  sectionOrder: shape.sectionOrder,
})
export type DraftWithoutIds = z.infer<typeof draftWithoutIdsSchema>

/** Where a model question points: an item by its index in the block, mapped to its id later. */
export const submissionTargetSchema = z.object({
  section: z.enum(CV_SECTIONS),
  itemIndex: z.int().nonnegative().optional(),
  field: z.string().min(1).max(60).optional(),
})
export type SubmissionTarget = z.infer<typeof submissionTargetSchema>

export const submissionQuestionSchema = z.object({
  kind: z.enum(['text', 'choice']),
  text: z.string().min(1).max(300),
  label: z.string().min(1).max(60),
  options: z.array(z.string().min(1).max(100)).max(SUBMISSION_LIMITS.options).optional(),
  target: submissionTargetSchema,
})
export type SubmissionQuestion = z.infer<typeof submissionQuestionSchema>

/**
 * The input of `submit_draft`: the whole draft, an evidence quote per claim (in the source's
 * language), questions for what the source doesn't say, the role's requirements and up to three
 * other roles the person fits. Zod checks it locally; an invalid input goes back to the model.
 */
export const draftSubmissionSchema = z.object({
  cv: draftWithoutIdsSchema,
  evidence: z
    .array(z.object({ path: z.string().min(1).max(100), quote: z.string().min(1).max(1000) }))
    .max(SUBMISSION_LIMITS.evidence),
  questions: z.array(submissionQuestionSchema).max(SUBMISSION_LIMITS.questions),
  requirements: z.array(requirementSchema.omit({ id: true })).max(SUBMISSION_LIMITS.requirements),
  suggestedRoles: z.array(z.string().min(1).max(100)).max(SUBMISSION_LIMITS.suggestedRoles),
})
export type DraftSubmission = z.infer<typeof draftSubmissionSchema>
