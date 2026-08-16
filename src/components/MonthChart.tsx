/**
 * Daily spending for the period, one bar per day of the calendar month.
 *
 * The bars answer "what did we spend that day"; the dashed line is the daily
 * target, so a bar crossing it is a day that ate into the balance. That
 * position is the real signal — the red/green fill is a second, redundant cue
 * rather than the only one, which is what keeps it legible to a colourblind
 * reader.
 */

import type { AllowanceResult } from "../domain/allowance"
import { eachDay, type IsoDate, parse } from "../domain/dates"
import { longDate, money } from "./format"

export interface MonthChartProps {
  allowance: AllowanceResult
}

const W = 620
const TOP = 16
const BASE = 120
const LABELS = 140

/** A bar with rounded top corners only; the bottom sits flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  if (h <= 0) return ""
  return [
    `M${x},${BASE}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${BASE}`,
    "Z",
  ].join(" ")
}

export const MonthChart = ({ allowance }: MonthChartProps) => {
  const { periodStart, periodEnd, today, dailyTarget, rows } = allowance
  const days = eachDay(periodStart, periodEnd)
  if (days.length === 0) return null

  const spentByDay = new Map(rows.map((r) => [r.date, r.spent]))
  const peak = Math.max(...rows.map((r) => r.spent), dailyTarget * 1.25)
  const colW = W / days.length
  const barW = Math.max(colW - 3, 2)
  const y = (v: number) => BASE - (v / peak) * (BASE - TOP)
  const targetY = y(dailyTarget)

  // Every fifth day, plus the last one — but only if it is far enough from the
  // previous label to not collide, which is what "30 31" would do.
  const lastDay = parse(days[days.length - 1] as string).day
  const labelled = (day: number) =>
    day === 1 || day % 5 === 0 || (day === lastDay && day - Math.floor(day / 5) * 5 >= 3)

  const tip = (date: IsoDate): string => {
    const spent = spentByDay.get(date)
    if (date > today) return `${longDate(date)} · not yet`
    return `${longDate(date)} · ${money(spent ?? 0)} spent${date === today ? " so far" : ""}`
  }

  return (
    <figure class="month-chart mt-3 mb-0">
      <svg
        viewBox={`0 0 ${W} ${LABELS + 4}`}
        role="img"
        aria-label={`Daily spending for ${longDate(periodStart)} to ${longDate(periodEnd)}, against a ${money(dailyTarget)} daily target`}
      >
        <title>Daily spending against the {money(dailyTarget)} daily target</title>

        {days.map((date, i) => {
          const dt = parse(date)
          if (dt.weekday < 6) return null
          return (
            <rect
              key={`wk-${date}`}
              x={i * colW}
              y={TOP}
              width={colW}
              height={BASE - TOP}
              fill="currentColor"
              opacity="0.05"
            />
          )
        })}

        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="currentColor" opacity="0.3" />

        {days.map((date, i) => {
          const dt = parse(date)
          const spent = spentByDay.get(date)
          const future = date > today
          const x = i * colW + (colW - barW) / 2

          // Days that have not happened yet are drawn as an outline at half the
          // target, so the month keeps its full width from the 1st and the
          // remaining runway is visible rather than implied by empty space.
          const mark = future ? (
            <rect
              x={x}
              y={y(dailyTarget / 2)}
              width={barW}
              height={BASE - y(dailyTarget / 2)}
              fill="none"
              stroke="var(--bs-success)"
              stroke-width="1"
              stroke-dasharray="3 3"
              opacity="0.4"
              rx="2"
            />
          ) : (
            <path
              d={barPath(x, y(spent ?? 0), barW, BASE - y(spent ?? 0))}
              fill={(spent ?? 0) > dailyTarget ? "var(--bs-danger)" : "var(--bs-success)"}
              stroke={date === today ? "var(--bs-body-color)" : "none"}
              stroke-width="1"
              stroke-opacity="0.55"
            />
          )

          return (
            <g key={date}>
              {mark}
              {labelled(dt.day) ? (
                <text
                  x={i * colW + colW / 2}
                  y={LABELS}
                  text-anchor="middle"
                  font-size="10"
                  fill="currentColor"
                  opacity={date === today ? "0.9" : "0.55"}
                  font-weight={date === today ? "600" : "400"}
                >
                  {dt.day}
                </text>
              ) : null}
            </g>
          )
        })}

        <line
          x1="0"
          y1={targetY}
          x2={W}
          y2={targetY}
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="5 4"
          opacity="0.55"
        />
        <text
          x={W - 2}
          y={targetY - 4}
          text-anchor="end"
          font-size="10"
          fill="currentColor"
          opacity="0.7"
        >
          {money(dailyTarget)}/day
        </text>
      </svg>
      {/*
        The hover targets are HTML, not SVG: Popper positions against
        offsetParent, which SVG children do not have, so a tooltip anchored to a
        <rect> renders unpositioned at the foot of the document. These columns
        sit exactly over the plot area instead.
      */}
      <div class="month-chart-hover" aria-hidden="true">
        {days.map((date) => (
          <div key={`hit-${date}`} data-bs-toggle="tooltip" data-bs-title={tip(date)} />
        ))}
      </div>
    </figure>
  )
}
