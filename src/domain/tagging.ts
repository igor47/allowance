/**
 * What a tag click means.
 *
 * Classifying tags are mutually exclusive — a transaction is spending or
 * recurring or irregular, never two — and clicking the tag a transaction
 * already has removes it, returning the transaction to unreviewed. Person tags
 * are an independent axis and toggle freely, so "spending, Serena" is expressible.
 */

import { CLASSIFYING_TAGS, PERSON_TAGS } from "./policy"

export type TagAction = { kind: "classify" | "person"; tag: string }

export function parseTagAction(tag: string): TagAction {
  const name = tag.toLowerCase()
  if (CLASSIFYING_TAGS.includes(name)) return { kind: "classify", tag: name }
  if (PERSON_TAGS.includes(name)) return { kind: "person", tag: name }
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
