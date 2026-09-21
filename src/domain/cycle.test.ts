import { describe, expect, test } from "bun:test"
import { cycleView } from "./cycle"

const CLOSE = 12
const DUE = 9

describe("statement cycles", () => {
  test("mid-cycle: last statement closed this month, next bill accruing", () => {
    const view = cycleView("2026-08-14", { closeDay: CLOSE, dueDay: DUE })
    expect(view.lastClosed).toEqual({ start: "2026-07-13", end: "2026-08-12", due: "2026-09-09" })
    expect(view.current).toEqual({ start: "2026-08-13", end: "2026-08-14", closes: "2026-09-12" })
  })

  test("before the close, the last statement is from the previous month", () => {
    const view = cycleView("2026-08-11", { closeDay: CLOSE, dueDay: DUE })
    expect(view.lastClosed).toEqual({ start: "2026-06-13", end: "2026-07-12", due: "2026-08-09" })
    expect(view.current.start).toBe("2026-07-13")
  })

  test("on close day the statement has closed", () => {
    const view = cycleView("2026-08-12", { closeDay: CLOSE, dueDay: DUE })
    expect(view.lastClosed.end).toBe("2026-08-12")
    expect(view.current.start).toBe("2026-08-13")
  })

  test("crosses the year boundary", () => {
    const view = cycleView("2027-01-05", { closeDay: CLOSE, dueDay: DUE })
    expect(view.lastClosed).toEqual({ start: "2026-11-13", end: "2026-12-12", due: "2027-01-09" })
  })

  test("a close day past the end of a short month clamps", () => {
    const view = cycleView("2026-03-05", { closeDay: 31, dueDay: DUE })
    expect(view.lastClosed.end).toBe("2026-02-28")
  })
})

/*
 * The other way an issuer says it: the due date is fixed and the close is a set
 * number of days before it, so the close day drifts with the length of the
 * month. Due on the 12th and closing 25 days earlier, throughout.
 */
describe("a statement that closes a fixed number of days before it is due", () => {
  const FLOATING = { closeDaysBeforeDue: 25, dueDay: 12 }

  test("the close lands on a different day of the month from one month to the next", () => {
    const view = cycleView("2026-09-20", FLOATING)
    // August has 31 days and September 30, so consecutive closes are the 18th
    // and the 17th. A fixed close day gets one of them wrong.
    expect(view.settled).toEqual({ start: "2026-07-19", end: "2026-08-18", due: "2026-09-12" })
    expect(view.lastClosed).toEqual({ start: "2026-08-19", end: "2026-09-17", due: "2026-10-12" })
    expect(view.current).toEqual({ start: "2026-09-18", end: "2026-09-20", closes: "2026-10-18" })
  })

  test("the day before the close still belongs to the statement before", () => {
    expect(cycleView("2026-08-17", FLOATING).lastClosed.end).toBe("2026-07-18")
    expect(cycleView("2026-08-18", FLOATING).lastClosed.end).toBe("2026-08-18")
  })

  test("February pulls the close back by three days", () => {
    const view = cycleView("2026-03-01", FLOATING)
    expect(view.lastClosed).toEqual({ start: "2026-01-19", end: "2026-02-15", due: "2026-03-12" })
  })

  test("a grace period longer than a month still finds the latest close", () => {
    // Due on the 5th, closing forty days before: the statement due in
    // September closed in July, and by August 1st it is the latest one.
    const view = cycleView("2026-08-01", { closeDaysBeforeDue: 40, dueDay: 5 })
    expect(view.lastClosed).toEqual({ start: "2026-06-27", end: "2026-07-27", due: "2026-09-05" })
    expect(view.settled.due).toBe("2026-08-05")
  })
})
