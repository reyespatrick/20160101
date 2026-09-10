import { createSimpleDb } from './simpleDb'

/**
 * Valuations, kept beside the listing they describe rather than in the browser.
 *
 * A valuation costs a call to Claude and a round trip through apiweb's comparables: it is the
 * most expensive thing the app produces, and the least likely to change between two openings of
 * the same listing. It belongs with the listing, in the same database as everything else the
 * device holds, so it survives a cleared cache and travels with the agency's data.
 */
export const estimatesDb = createSimpleDb('immoba-estimates', 'estimates')
