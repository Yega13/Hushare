import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_CATALOGUE, formatPrice, monthsSaved } from '../src/lib/plan-catalogue'

describe('formatPrice', () => {
  it('renders whole dollars the way the pricing page writes them', () => {
    expect(formatPrice(400)).toBe('$4')
    expect(formatPrice(4000)).toBe('$40')
    expect(formatPrice(10000)).toBe('$100')
  })

  it('keeps the cents when there are any', () => {
    expect(formatPrice(199)).toBe('$1.99')
    expect(formatPrice(699)).toBe('$6.99')
    expect(formatPrice(450)).toBe('$4.50')
  })
})

describe('monthsSaved', () => {
  it('backs the "save 2 months" claim both plans make', () => {
    expect(monthsSaved(PLAN_CATALOGUE.pro_monthly.amountCents, PLAN_CATALOGUE.pro_yearly.amountCents)).toBe(2)
    expect(monthsSaved(PLAN_CATALOGUE.studio_monthly.amountCents, PLAN_CATALOGUE.studio_yearly.amountCents)).toBe(2)
  })

  it('cannot divide by a zero monthly price', () => {
    expect(monthsSaved(0, 10000)).toBe(0)
  })

  it('actually computes, rather than returning the answer both plans happen to have', () => {
    // Both real plans save exactly 2 months, so a test using only those passes against a
    // function that returns a hardcoded 2 — which the mutation run proved (rule 16).
    expect(monthsSaved(1000, 9000)).toBe(3)
    expect(monthsSaved(500, 6000)).toBe(0)
    expect(monthsSaved(1000, 12000)).toBe(0)
    expect(monthsSaved(200, 1800)).toBe(3)
  })
})

describe('the catalogue matches what /pricing advertises', () => {
  // The pricing page is static text for speed, so the numbers are written there too. This is the
  // test rule 13 demands in place of an import: it reads the REAL page source, so the copy cannot
  // drift from the catalogue that the Polar health check verifies against Polar.
  const page = readFileSync(join(process.cwd(), 'src', 'app', 'pricing', 'page.tsx'), 'utf8')

  it('every monthly and yearly price appears on the page', () => {
    expect(page).toContain(`price: '${formatPrice(PLAN_CATALOGUE.pro_monthly.amountCents)}'`)
    expect(page).toContain(`price: '${formatPrice(PLAN_CATALOGUE.studio_monthly.amountCents)}'`)
    expect(page).toContain(`${formatPrice(PLAN_CATALOGUE.pro_yearly.amountCents)} / year`)
    expect(page).toContain(`${formatPrice(PLAN_CATALOGUE.studio_yearly.amountCents)} / year`)
  })

  it('the yearly plans are advertised as YEARLY, which is the bug this exists for', () => {
    // Hushare Studio (Yearly) was configured at Polar to charge $100 every MONTH while this page
    // said "$100 / year". Nobody had bought it, so the first annual Max customer would have been
    // charged $1,200 for a $100 plan.
    expect(PLAN_CATALOGUE.pro_yearly.interval).toBe('year')
    expect(PLAN_CATALOGUE.studio_yearly.interval).toBe('year')
    expect(PLAN_CATALOGUE.pro_monthly.interval).toBe('month')
    expect(PLAN_CATALOGUE.studio_monthly.interval).toBe('month')
  })

  it('a yearly plan costs less than twelve monthly ones, or it is not an offer', () => {
    for (const [monthly, yearly] of [
      [PLAN_CATALOGUE.pro_monthly, PLAN_CATALOGUE.pro_yearly],
      [PLAN_CATALOGUE.studio_monthly, PLAN_CATALOGUE.studio_yearly],
    ] as const) {
      expect(yearly.amountCents).toBeLessThan(monthly.amountCents * 12)
    }
  })

  it('the yearly side of the switch posts the YEARLY plan, and shows the yearly price', () => {
    // A switch that flips the label but keeps posting `pro_monthly` sells a monthly plan to
    // someone who chose yearly — silent, and only discoverable on a bank statement. These read
    // the real page source, so both forms and both price blocks must exist.
    // Positional, not "contains somewhere". A first pass asserted only that the string existed
    // in the file, and the mutation run proved it worthless: swapping the yearly form's plan to
    // the monthly one still left the string present elsewhere and the test stayed green.
    const formStart = page.indexOf('className="w-full hush-yearly-only"')
    expect(formStart).toBeGreaterThan(0)
    const yearlyForm = page.slice(formStart, page.indexOf('</form>', formStart))
    expect(yearlyForm).toContain('value={t.yearlyPlan}')
    expect(yearlyForm).not.toContain('value={t.monthlyPlan}')
    // Exactly one checkout form per cycle — the redundant second yearly route is gone.
    expect(page.split('value={t.yearlyPlan}')).toHaveLength(2)
    expect(page.split('value={t.monthlyPlan}')).toHaveLength(2)
    // The monthly form must carry the hide-class, or BOTH buttons render on the yearly side and
    // the card offers two prices at once. Checked on the form itself: asserting the class merely
    // appears somewhere in the file passed while the form had lost it.
    const monthlyAt = page.indexOf('value={t.monthlyPlan}')
    const monthlyForm = page.slice(page.lastIndexOf('<form', monthlyAt), monthlyAt)
    expect(monthlyForm).toContain('hush-monthly-only')
    // The yearly price is derived, never typed, so it cannot drift from the catalogue that the
    // Polar health check verifies against Polar itself.
    expect(page).toContain('formatPrice(PLAN_CATALOGUE.pro_yearly.amountCents)')
    expect(page).toContain('formatPrice(PLAN_CATALOGUE.studio_yearly.amountCents)')
  })

  it('the first-month intro badge never shows beside a yearly price', () => {
    // The intro discount applies to monthly checkouts only. Advertising "First month $1.99"
    // above a yearly button promises a discount the yearly checkout will not apply.
    const start = page.indexOf('{t.promo && (')
    expect(start).toBeGreaterThan(0)
    expect(page.slice(start, start + 400)).toContain('hush-monthly-only')
  })

  it('the switch markup and the switch stylesheet agree on every hook', () => {
    // The switch is CSS-only, so a renamed class or value breaks it SILENTLY: nothing throws,
    // no test of behaviour fails, and the button simply stops changing. This binds the two
    // files that have to agree.
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'styles', 'pricing.css'), 'utf8')
    for (const hook of ['hush-cycle-radio', 'hush-monthly-only', 'hush-yearly-only', 'hush-cycle-thumb']) {
      // Whole-name matching. A plain `toContain` passed when the rule had been renamed to
      // `.hush-cycle-thumbx`, because the old name is still a substring of the new one — the
      // element would have rendered with no style at all and the test stayed green.
      const whole = new RegExp('\\.' + hook + '(?![\\w-])')
      expect(css.match(whole), `${hook} is rendered but has no rule of its own`).not.toBeNull()
      expect(page, `${hook} is styled but never rendered`).toContain(hook)
    }
    // The sliding thumb needs its own BASE rule, not just the state rules that move it. Renaming
    // only the base rule left the state rules matching, so the whole-name check above passed
    // while the thumb rendered as an unstyled span — invisible, and the switch looks broken.
    expect(css).toMatch(/^\s*\.hush-cycle-thumb\s*\{/m)
    // The labels ARE the control — the radios themselves are visually hidden. Asserting the rule
    // merely exists proved nothing (an identically-named rule inside the reduced-motion query
    // matched it), so this reads the block and checks it still makes them look clickable.
    const optAt = css.indexOf('.hush-cycle-opt {')
    expect(optAt, 'the switch labels have no base rule').toBeGreaterThan(0)
    expect(css.slice(optAt, css.indexOf('}', optAt))).toContain('cursor: pointer')
    // The CSS keys on the radio's VALUE, not its id, so every card is served by one rule.
    expect(page).toContain('value="monthly"')
    expect(page).toContain('value="yearly"')
    // The two LOAD-BEARING pairings, asserted as whole selectors. Checking only that each value
    // appears somewhere in the file passed while one rule had been renamed to a value no radio
    // ever has — the switch would have shown both prices at once, silently.
    expect(css).toContain('[value="yearly"]:checked ~ .hush-monthly-only')
    expect(css).toContain('[value="monthly"]:checked ~ .hush-yearly-only')
    // And no rule may key on a value the markup never sets.
    for (const v of css.match(/\[value="([a-z]+)"\]/g) ?? []) {
      expect(['[value="monthly"]', '[value="yearly"]'], `${v} matches no radio`).toContain(v)
    }
  })

  it('each card has its own radio group, so the two plans switch independently', () => {
    // A shared group name would make Pro and Max move together — the whole point of the change
    // was that somebody comparing Pro monthly against Max yearly could not see both at once.
    expect(page).toContain('name={`cyc-${t.name.toLowerCase()}`}')
    expect(page).not.toContain('name="hush-cycle"')
  })

  it('every plan names a distinct product env var', () => {
    const vars = Object.values(PLAN_CATALOGUE).map((p) => p.envVar)
    expect(new Set(vars).size).toBe(vars.length)
  })
})
