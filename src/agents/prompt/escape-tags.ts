/**
 * Escapes text placed inside a prompt tag, so user data can't close the tag or open another one
 * (`</source><cv_language>…`). The instructions tell the model the contents are XML-escaped.
 */
export const escapeTagContent = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
