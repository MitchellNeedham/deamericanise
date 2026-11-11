import { describe, expect, it } from 'vitest';
import { CATEGORIES, DIALECTS, deamericanise, ruleCatalogue, ruleIds } from '../src/index.js';
import type { Dialect } from '../src/index.js';

const dialects = Object.keys(DIALECTS) as Dialect[];

describe('ruleCatalogue', () => {
  it.each(dialects)('labels every rule in %s', (dialect) => {
    for (const rule of ruleCatalogue(dialect)) {
      expect(rule.label, rule.id).not.toBe(rule.id);
      expect(rule.example, rule.id).toMatch(/ for /);
    }
  });

  it.each(dialects)('puts every rule in %s in a known category and tier', (dialect) => {
    for (const rule of ruleCatalogue(dialect)) {
      expect(CATEGORIES).toContain(rule.category);
      expect(rule.confidence.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('lists the same ids as ruleIds', () => {
    for (const dialect of dialects) {
      expect(ruleCatalogue(dialect).map((r) => r.id)).toEqual(ruleIds(dialect));
    }
  });

  it('marks units kept by every dialect as off by default', () => {
    const cup = ruleCatalogue().find((r) => r.id === 'units.volume.cup')!;
    expect(cup.offByDefault).toBe(true);
    expect(ruleCatalogue().find((r) => r.id === 'units.length.foot')!.offByDefault).toBe(false);
  });

  it('marks what a dialect keeps or switches off as off by default', () => {
    const offIn = (dialect: Dialect, id: string) =>
      ruleCatalogue(dialect).find((r) => r.id === id)!.offByDefault;
    expect(offIn('en-GB', 'units.length.mile')).toBe(true);
    expect(offIn('en-AU', 'units.length.mile')).toBe(false);
    expect(offIn('en-GB', 'units.mass.stone-pounds')).toBe(true);
    expect(offIn('en-GB', 'units.mass.pounds-ounces')).toBe(false);
    expect(offIn('en-AU', 'units.mass.stone-pounds')).toBe(false);
    expect(offIn('en-CA', 'spelling.ise')).toBe(true);
    expect(offIn('en-CA', 'vocabulary.food')).toBe(true);
    expect(offIn('en-CA', 'spelling.our')).toBe(false);
  });

  it('matches the category of the changes each rule makes', () => {
    const byId = new Map(ruleCatalogue().map((r) => [r.id, r]));
    const text =
      'The color of the theater. It is 6 feet tall, 350°F, on 3/14/2024 at 3:00 P.M. ' +
      'It cost $500. Buy an eraser and a bell pepper. Mr. Smith said "hello."';
    const { changes } = deamericanise(text, { preset: 'localise', assumeAmerican: true });
    expect(changes.length).toBeGreaterThan(8);
    for (const change of changes) {
      const rule = byId.get(change.ruleId);
      expect(rule, change.ruleId).toBeDefined();
      expect(rule!.category, change.ruleId).toBe(change.category);
    }
  });

  it('lists the tiers a rule needs, not the tiers of its changes', () => {
    const numeric = ruleCatalogue().find((r) => r.id === 'dates.numeric')!;
    expect(numeric.confidence).toEqual(['moderate']);
    const ids = (confidence: ('safe' | 'moderate' | 'risky')[]) =>
      deamericanise('on 3/14/2024', { confidence }).changes.map((c) => c.ruleId);
    expect(ids(['moderate'])).toEqual([]);
    expect(ids(['safe'])).toEqual([]);
    expect(ids(['safe', 'moderate'])).toEqual(['dates.numeric']);
  });

  it('marks only article agreement as not switchable', () => {
    const fixed = ruleCatalogue().filter((r) => !r.switchable).map((r) => r.id);
    expect(fixed).toEqual(['grammar.article-agreement']);
  });
});
