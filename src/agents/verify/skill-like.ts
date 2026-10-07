// words that look like technology names: Node.js, .NET, C++, C#, PostgreSQL, AWS, K8s
const SKILL_LIKE = [
  /\p{L}\.\p{L}{2,}/u,
  /^\.\p{L}/u,
  /\p{L}[+#]+$/u,
  /\p{Ll}\p{Lu}/u,
  /^\p{Lu}{2,}$/u,
  /\p{L}\p{N}|\p{N}\p{L}/u,
]

/** The words of a text without the punctuation around them ("(Node.js)," → "Node.js"). */
const wordsOf = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}.]+|[^\p{L}\p{N}+#]+$/gu, ''))
    .filter((word) => word !== '')

/** The words of `text` that look like technology names, as written. */
export const skillLikeWords = (text: string): string[] =>
  wordsOf(text).filter((word) => SKILL_LIKE.some((pattern) => pattern.test(word)))
