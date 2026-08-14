import { describe, expect, test } from "bun:test"
import { nextTags, parseTagAction } from "./tagging"

const classify = (tag: string) => parseTagAction(tag)

describe("classifying tags", () => {
  test("tagging an unreviewed transaction sets one tag", () => {
    expect(nextTags([], classify("spending"))).toEqual(["spending"])
  })

  test("they are mutually exclusive", () => {
    expect(nextTags(["spending"], classify("recurring"))).toEqual(["recurring"])
  })

  test("clicking the current tag returns it to unreviewed", () => {
    expect(nextTags(["recurring"], classify("recurring"))).toEqual([])
  })

  test("person tags survive a reclassification", () => {
    expect(nextTags(["spending", "serena"], classify("irregular")).sort()).toEqual([
      "irregular",
      "serena",
    ])
  })
})

describe("person tags", () => {
  test("toggle independently of the classification", () => {
    expect(nextTags(["spending"], classify("igor")).sort()).toEqual(["igor", "spending"])
    expect(nextTags(["spending", "igor"], classify("igor"))).toEqual(["spending"])
  })

  test("both people can be on one transaction", () => {
    expect(nextTags(["igor"], classify("serena")).sort()).toEqual(["igor", "serena"])
  })
})

test("unknown tags are rejected rather than written to Lunch Money", () => {
  expect(() => parseTagAction("groceries")).toThrow("unknown tag")
})
