const WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
})

/** Summary boxes read better without cents; transaction amounts need them. */
export const money = (n: number): string => WHOLE.format(n)
export const cents = (n: number): string => CENTS.format(n)

export const signed = (n: number): string => (n > 0 ? `+${money(n)}` : money(n))

export function shortDate(date: string): string {
  const [, month, day] = date.split("-")
  return `${Number(month)}/${Number(day)}`
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
