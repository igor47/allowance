import { describe, expect, test } from "bun:test"
import { cycleView } from "./cycle"

const CLOSE = 12
const DUE = 9

describe("statement cycles", () => {
  test("mid-cycle: last statement closed this month, next bill accruing", () => {
    const view = cycleView("2026-08-14", CLOSE, DUE)
    expect(view.lastClosed).toEqual({ start: "2026-07-13", end: "2026-08-12", due: "2026-09-09" })
    expect(view.current).toEqual({ start: "2026-08-13", end: "2026-08-14", closes: "2026-09-12" })
  })

  test("before the close, the last statement is from the previous month", () => {
    const view = cycleView("2026-08-11", CLOSE, DUE)
    expect(view.lastClosed).toEqual({ start: "2026-06-13", end: "2026-07-12", due: "2026-08-09" })
    expect(view.current.start).toBe("2026-07-13")
  })

  test("on close day the statement has closed", () => {
    const view = cycleView("2026-08-12", CLOSE, DUE)
    expect(view.lastClosed.end).toBe("2026-08-12")
    expect(view.current.start).toBe("2026-08-13")
  })

  test("crosses the year boundary", () => {
    const view = cycleView("2027-01-05", CLOSE, DUE)
    expect(view.lastClosed).toEqual({ start: "2026-11-13", end: "2026-12-12", due: "2027-01-09" })
  })

  test("a close day past the end of a short month clamps", () => {
    const view = cycleView("2026-03-05", 31, DUE)
    expect(view.lastClosed.end).toBe("2026-02-28")
  })
})
