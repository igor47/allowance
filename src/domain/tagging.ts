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

/**
 * `want` is the state the button asked for, which is what makes a click safe
 * to repeat. A toggle computed on the server meant a second click, sent while
 * the first was still in flight, found the tag already on and took it off
 * again — the row "unclicked itself". Absent only from a page rendered before
 * buttons said which way they meant, and then the click toggles as it did.
 */
export type TagAction = { kind: "classify" | "person"; tag: string; want?: boolean }

export function parseTagAction(tag: string, personTags: string[], set?: string): TagAction {
  const name = tag.toLowerCase()
  const want = set === undefined ? undefined : set === "on" ? true : set === "off" ? false : null
  if (want === null) throw new Error(`unknown state: ${set}`)
  if (CLASSIFYING_TAGS.includes(name)) return { kind: "classify", tag: name, want }
  if (personTags.includes(name)) return { kind: "person", tag: name, want }
  // Refusing an unknown tag is what keeps `/tag/:id/:tag` from writing
  // arbitrary strings into Lunch Money from a hand-typed URL.
  throw new Error(`unknown tag: ${tag}`)
}

export function nextTags(current: string[], action: TagAction): string[] {
  const tags = current.map((t) => t.toLowerCase())
  const on = action.want ?? !tags.includes(action.tag)
  const without = tags.filter((t) => t !== action.tag)

  // Turning a tag off removes that tag and nothing else. For a classifying
  // one that is usually all there is, but "spending off" arriving after the
  // row was re-tagged `recurring` must not take the `recurring` with it.
  if (!on || action.kind === "person") return on ? [...without, action.tag] : without

  // Turning one on displaces every other classifying tag.
  return [...tags.filter((t) => !CLASSIFYING_TAGS.includes(t)), action.tag]
}
