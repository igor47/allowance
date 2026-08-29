import { describe, expect, test } from "bun:test"
import { nextTags, parseTagAction } from "./tagging"

/** The suite's household, standing in for whatever `allowance.toml` says. */
const PEOPLE = ["alex", "sam"]

const classify = (tag: string) => parseTagAction(tag, PEOPLE)

describe("classifying tags", () => {
  test("tagging an unreviewed transaction sets one tag", () => {
    expect(nextTags([], classify("spending"))).toEqual(["spending"])
  })

  test("they are mutually exclusive", () => {
    expect(nextTags(["spending"], classify("recurring"))).toEqual(["recurring"])
  })

  test("transfer is one of them, so it displaces the others", () => {
    expect(nextTags(["spending"], classify("transfer"))).toEqual(["transfer"])
    expect(nextTags(["transfer"], classify("recurring"))).toEqual(["recurring"])
  })

  test("clicking the current tag returns it to unreviewed", () => {
    expect(nextTags(["recurring"], classify("recurring"))).toEqual([])
  })

  test("person tags survive a reclassification", () => {
    expect(nextTags(["spending", "sam"], classify("irregular")).sort()).toEqual([
      "irregular",
      "sam",
    ])
  })
})

describe("person tags", () => {
  test("toggle independently of the classification", () => {
    expect(nextTags(["spending"], classify("alex")).sort()).toEqual(["alex", "spending"])
    expect(nextTags(["spending", "alex"], classify("alex"))).toEqual(["spending"])
  })

  test("both people can be on one transaction", () => {
    expect(nextTags(["alex"], classify("sam")).sort()).toEqual(["alex", "sam"])
  })
})

test("unknown tags are rejected rather than written to Lunch Money", () => {
  expect(() => parseTagAction("groceries", PEOPLE)).toThrow("unknown tag")
})
