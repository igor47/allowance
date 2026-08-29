/**
 * What a tag click means.
 *
 * Classifying tags are mutually exclusive — a transaction is spending or
 * recurring or irregular, never two — and clicking the tag a transaction
 * already has removes it, returning the transaction to unreviewed. Person tags
 * are an independent axis and toggle freely, so "spending, and it was Sam's" is
 * expressible.
 *
 * The classifying tags are the domain's own vocabulary; the person tags arrive
 * as an argument, because who lives here is configuration.
 */

import { CLASSIFYING_TAGS } from "./policy"

export type TagAction = { kind: "classify" | "person"; tag: string }

export function parseTagAction(tag: string, personTags: string[]): TagAction {
  const name = tag.toLowerCase()
  if (CLASSIFYING_TAGS.includes(name)) return { kind: "classify", tag: name }
  if (personTags.includes(name)) return { kind: "person", tag: name }
  // Refusing an unknown tag is what keeps `/tag/:id/:tag` from writing
  // arbitrary strings into Lunch Money from a hand-typed URL.
  throw new Error(`unknown tag: ${tag}`)
}

export function nextTags(current: string[], action: TagAction): string[] {
  const tags = current.map((t) => t.toLowerCase())
  const has = tags.includes(action.tag)

  if (action.kind === "person") {
    return has ? tags.filter((t) => t !== action.tag) : [...tags, action.tag]
  }

  // Drop every classifying tag, then re-add unless this was a toggle-off.
  const kept = tags.filter((t) => !CLASSIFYING_TAGS.includes(t))
  return has ? kept : [...kept, action.tag]
}
