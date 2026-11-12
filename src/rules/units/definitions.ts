import { isMoney } from './money.js';

export interface MetricValue {
  value: number;
  symbol: string;
  singular: string;
  plural: string;
}

export interface Measure {
  id: string;
  /** Key a dialect can list in `unitsKeep` to leave this unit alone. */
  keep: string;
  /** Written-out forms, longest first. */
  words: string[];
  /** Abbreviations. Matched case-sensitively where case carries meaning. */
  abbrevs: string[];
  /**
   * Abbreviations read only inside a compound such as `11st 4lb`, where nothing else can
   * be meant. On their own they are other words: `1st` is an ordinal.
   */
  compoundAbbrevs?: string[];
  convert(value: number): MetricValue;
  /**
   * Contexts where the imperial unit is the worldwide convention: screens are sold in
   * inches everywhere, so are wheels, pipes and vinyl.
   */
  conventional?: { before?: RegExp; after?: RegExp };
  /**
   * Skip this measure entirely when the document matches. For units whose name means
   * different things in different places, the document usually says which it means.
   */
  ambiguousWhen?: RegExp;
  /**
   * Whether the written-out unit in the quantity `text.slice(start, end)` is being used in
   * another sense, such as `pounds` for money or the `pound` of `pound cake`. Checked
   * whatever `respectConventions` says, because what it finds is not a measurement at all.
   */
  otherSense?: (text: string, start: number, end: number) => boolean;
  /**
   * Left alone unless the rule is turned on by id. For measures that are not American at
   * all, merely imperial-descended and used everywhere.
   */
  keptByDefault?: boolean;
}

const m = (value: number, symbol: string, singular: string, plural: string): MetricValue => ({
  value,
  symbol,
  singular,
  plural,
});

/** Picks the metric unit a person would actually write for this magnitude. */
export function metricLength(metres: number): MetricValue {
  const abs = Math.abs(metres);
  if (abs >= 1000) return m(metres / 1000, 'km', 'kilometre', 'kilometres');
  if (abs >= 1) return m(metres, 'm', 'metre', 'metres');
  if (abs >= 0.01) return m(metres * 100, 'cm', 'centimetre', 'centimetres');
  return m(metres * 1000, 'mm', 'millimetre', 'millimetres');
}

export function metricMass(grams: number): MetricValue {
  const abs = Math.abs(grams);
  if (abs >= 1_000_000) return m(grams / 1_000_000, 't', 'tonne', 'tonnes');
  if (abs >= 1000) return m(grams / 1000, 'kg', 'kilogram', 'kilograms');
  return m(grams, 'g', 'gram', 'grams');
}

export function metricVolume(millilitres: number): MetricValue {
  const abs = Math.abs(millilitres);
  if (abs >= 1000) return m(millilitres / 1000, 'L', 'litre', 'litres');
  return m(millilitres, 'mL', 'millilitre', 'millilitres');
}

export function metricArea(squareMetres: number): MetricValue {
  const abs = Math.abs(squareMetres);
  if (abs >= 1_000_000) return m(squareMetres / 1_000_000, 'km²', 'square kilometre', 'square kilometres');
  if (abs >= 10_000) return m(squareMetres / 10_000, 'ha', 'hectare', 'hectares');
  return m(squareMetres, 'm²', 'square metre', 'square metres');
}

/**
 * Screens, wheels, pipes, records and fasteners are sized in inches the world over. A
 * 3/8 inch bolt is a designation rather than a measurement: there is no metric bolt of
 * 9.5 mm, and a workshop happily mixes a 10 mm bolt and a 3/8 inch bolt in one sentence.
 */
const INCH_CONVENTIONS = {
  // A few function words may sit between the thing and its size. A bolt described as up
  // to an inch in diameter is being named; a bolt described as standing away from a wall
  // is being measured. Allowing only function words between the two keeps them apart.
  before: new RegExp(
    String.raw`\b(?:screen|display|monitor|touchscreen|laptop|tablet|phone|tv|television|panel|` +
      String.raw`wheels?|rims?|tyres?|tires?|pipes?|bore|vinyl|record|drive|disk|disc|barrel|waist|` +
      String.raw`chest|inseam|sensor|lens|nails?|bolts?|screws?|nuts?|washers?|sockets?|wrench(?:es)?|` +
      String.raw`spanners?|threads?|rivets?|studs?|drill|bit)\b` +
      String.raw`(?:\s+(?:up|to|above|below|over|under|of|and|or|the|a|an|about|approximately|` +
      String.raw`larger|smaller|greater|less|than|from|in|is|are|measuring)){0,4}[\s-]*$`,
    'i',
  ),
  // Up to three words may sit between the measurement and the thing measured, as in
  // `a 12-inch capacitive LCD touchscreen`.
  after:
    /^[\s-]*(?:[\w-]+\s+){0,3}(?:screens?|displays?|monitors?|touchscreens?|laptops?|tablets?|macbook|tvs?|televisions?|panels?|wheels?|rims?|tyres?|tires?|pipes?|vinyl|records?|drives?|disks?|discs?|floppy|barrels?|sensors?|lens|lenses|nails?|pizzas?|subwoofers?|speakers?|bolts?|screws?|nuts?|washers?|sockets?|wrench(?:es)?|spanners?|threads?|hex|ratchets?|rivets?|studs?|dowels?|taps?|fittings?|couplings?|nipples?|unions?|elbows?|npt|unc|unf|bits?)\b/i,
};

/**
 * Whether the singular unit word `word`, ending the quantity `text.slice(start, end)`, is
 * the first part of a noun that `nouns` finds after it, as `pound` is in `Bake 1 pound cake`.
 * The number then counts the noun. A hyphen ties a unit to its number, so `a 2-pound cake`
 * is a weight.
 */
function startsNoun(word: string, nouns: RegExp) {
  const unit = new RegExp(String.raw`(?<![-A-Za-z])${word}$`, 'i');
  return (text: string, start: number, end: number): boolean =>
    unit.test(text.slice(start, end)) && nouns.test(text.slice(end, end + 40));
}

const poundCake = startsNoun('pound', /^[\s-]+cakes?\b/i);

/**
 * Word forms that are grammatically singular. A singular unit next to a number that is
 * not one is being used attributively (`a 9 inch dish`), and its replacement should stay
 * singular too.
 */
export const SINGULAR_WORDS = new Set([
  'inch', 'foot', 'yard', 'mile', 'fathom', 'acre', 'square foot', 'sq foot',
  'ounce', 'pound', 'ton', 'fluid ounce', 'gallon', 'quart', 'pint', 'cup',
  'tablespoon', 'teaspoon', 'cubic foot',
]);

export const MEASURES: Measure[] = [
  // ----- length -----
  {
    id: 'units.length.inch',
    keep: 'inch',
    words: ['inches', 'inch'],
    abbrevs: ['in.', 'in', '″', '"', '”'],
    convert: (v) => metricLength(v * 0.0254),
    conventional: INCH_CONVENTIONS,
    otherSense: startsNoun('inch', /^[\s-]+worms?\b/i),
  },
  {
    id: 'units.length.foot',
    keep: 'foot',
    words: ['feet', 'foot'],
    abbrevs: ['ft.', 'ft', '′'],
    convert: (v) => metricLength(v * 0.3048),
    otherSense: startsNoun('foot', /^[\s-]+(?:soldiers?|traffic)\b/i),
  },
  {
    id: 'units.length.yard',
    keep: 'yard',
    words: ['yards', 'yard'],
    abbrevs: ['yds', 'yd'],
    convert: (v) => metricLength(v * 0.9144),
    // A gridiron yard line and the 40 yard dash are names for things, not lengths. There
    // is no 37 metre line painted on any field.
    conventional: { after: /^[\s-]*(?:lines?|dash|markers?)\b/i },
  },
  {
    id: 'units.length.mile',
    keep: 'mile',
    words: ['miles', 'mile'],
    abbrevs: ['mi'],
    convert: (v) => metricLength(v * 1609.344),
  },
  {
    id: 'units.length.fathom',
    keep: 'fathom',
    words: ['fathoms', 'fathom'],
    abbrevs: [],
    convert: (v) => metricLength(v * 1.8288),
  },

  // ----- area -----
  {
    id: 'units.area.acre',
    keep: 'acre',
    words: ['acres', 'acre'],
    abbrevs: [],
    convert: (v) => metricArea(v * 4046.856),
  },
  {
    id: 'units.area.square-foot',
    keep: 'square-foot',
    words: ['square feet', 'square foot', 'sq feet', 'sq foot'],
    abbrevs: ['sq ft', 'sqft', 'ft²'],
    convert: (v) => metricArea(v * 0.09290304),
  },
  {
    id: 'units.area.square-mile',
    keep: 'square-mile',
    words: ['square miles', 'square mile', 'sq miles', 'sq mile'],
    abbrevs: ['sq mi', 'mi²'],
    convert: (v) => metricArea(v * 2_589_988.11),
  },

  // ----- mass -----
  {
    id: 'units.mass.ounce',
    keep: 'ounce',
    words: ['ounces', 'ounce'],
    abbrevs: ['oz'],
    convert: (v) => metricMass(v * 28.349523125),
  },
  {
    id: 'units.mass.pound',
    keep: 'pound',
    words: ['pounds', 'pound'],
    abbrevs: ['lbs', 'lb'],
    convert: (v) => metricMass(v * 453.59237),
    // Fighting weight classes are designations. The 147-pound division is called that
    // whatever the scales say in kilograms.
    conventional: {
      after: /^[\s-]*(?:divisions?|classes|class|limits?|bouts?|titles?|champions?|weight)\b/i,
    },
    otherSense: (text, start, end) =>
      isMoney(text, start, end) || poundCake(text, start, end),
  },
  {
    id: 'units.mass.stone',
    keep: 'stone',
    words: ['stone'],
    abbrevs: [],
    compoundAbbrevs: ['st'],
    convert: (v) => metricMass(v * 6350.29318),
  },
  {
    id: 'units.mass.ton',
    keep: 'ton',
    words: ['tons', 'ton'],
    abbrevs: [],
    // The US short ton. A document that also says `metric ton` or `tonne` is measuring in
    // those already, and reading its tons as short tons would be plainly wrong.
    convert: (v) => metricMass(v * 907_184.74),
    ambiguousWhen: /\b(?:metric\s+tons?|tonnes?|long\s+tons?)\b/i,
  },

  // ----- volume. Every one of these is the US measure, which is not the imperial one. -----
  {
    id: 'units.volume.fluid-ounce',
    keep: 'fluid-ounce',
    words: ['fluid ounces', 'fluid ounce'],
    abbrevs: ['fl oz', 'fl. oz.', 'floz'],
    convert: (v) => metricVolume(v * 29.5735295625),
  },
  {
    id: 'units.volume.gallon',
    keep: 'gallon',
    words: ['gallons', 'gallon'],
    abbrevs: ['gal'],
    convert: (v) => metricVolume(v * 3785.411784),
  },
  {
    id: 'units.volume.quart',
    keep: 'quart',
    words: ['quarts', 'quart'],
    abbrevs: ['qt'],
    convert: (v) => metricVolume(v * 946.352946),
  },
  {
    id: 'units.volume.pint',
    keep: 'pint',
    words: ['pints', 'pint'],
    // `pt` is left out: `12pt` is a font size far more often than a pint.
    abbrevs: [],
    convert: (v) => metricVolume(v * 473.176473),
  },
  {
    // Cups are used in Australian and British kitchens too, so this is not a translation.
    // Worth knowing: a US cup is 237 mL and an Australian one is 250 mL.
    id: 'units.volume.cup',
    keep: 'cup',
    keptByDefault: true,
    words: ['cups', 'cup'],
    abbrevs: [],
    convert: (v) => metricVolume(v * 236.5882365),
  },
  {
    // Universal in recipes. The trap is that an Australian tablespoon is 20 mL while
    // everyone else's is 15 mL, but rewriting it as millilitres reads like a lab protocol.
    id: 'units.volume.tablespoon',
    keep: 'tablespoon',
    keptByDefault: true,
    words: ['tablespoons', 'tablespoon'],
    abbrevs: ['tbsp', 'tbs'],
    convert: (v) => metricVolume(v * 14.78676478),
  },
  {
    // Universal in recipes, and 5 mL almost everywhere.
    id: 'units.volume.teaspoon',
    keep: 'teaspoon',
    keptByDefault: true,
    words: ['teaspoons', 'teaspoon'],
    abbrevs: ['tsp'],
    convert: (v) => metricVolume(v * 4.92892159),
  },
  {
    id: 'units.volume.cubic-foot',
    keep: 'cubic-foot',
    words: ['cubic feet', 'cubic foot'],
    abbrevs: ['cu ft', 'ft³'],
    convert: (v) => metricVolume(v * 28_316.8466),
  },

  // ----- speed, pressure, power, energy -----
  {
    id: 'units.speed.mph',
    keep: 'mph',
    words: ['miles per hour', 'miles an hour'],
    abbrevs: ['mph', 'MPH'],
    convert: (v) => m(v * 1.609344, 'km/h', 'kilometre per hour', 'kilometres per hour'),
  },
  {
    id: 'units.pressure.psi',
    keep: 'psi',
    words: ['pounds per square inch'],
    abbrevs: ['psi', 'PSI'],
    convert: (v) => m(v * 6.89475729, 'kPa', 'kilopascal', 'kilopascals'),
  },
  {
    id: 'units.power.horsepower',
    keep: 'horsepower',
    words: ['horsepower'],
    abbrevs: ['hp'],
    convert: (v) => m(v * 0.745699872, 'kW', 'kilowatt', 'kilowatts'),
  },
  {
    id: 'units.energy.btu',
    keep: 'btu',
    words: ['british thermal units', 'british thermal unit'],
    abbrevs: ['BTU', 'BTUs'],
    convert: (v) => m(v * 1.05505585, 'kJ', 'kilojoule', 'kilojoules'),
  },
  {
    id: 'units.torque.foot-pound',
    keep: 'foot-pound',
    words: ['foot-pounds', 'foot pounds', 'foot-pound', 'pound-feet', 'pound feet', 'pound-foot'],
    // `lb ft` has to be listed, or the mass rule claims the number first and the
    // torque silently becomes a weight.
    abbrevs: ['ft-lb', 'ft-lbs', 'ft lb', 'ft lbs', 'lb-ft', 'lb ft', 'lbft', 'lb.ft'],
    convert: (v) => m(v * 1.3558179483, 'N·m', 'newton metre', 'newton metres'),
  },
];

/** One measurement written in descending units of one dimension, as `11 stone 4 pounds` is. */
export interface Compound {
  id: string;
  /** Largest first. The first two must be present and the rest may follow. */
  measures: Measure[];
  /** How many of each measure after the first make one of the measure before it. */
  per: number[];
}

const measure = (id: string): Measure => MEASURES.find((each) => each.id === id)!;

export const COMPOUNDS: Compound[] = [
  {
    id: 'units.mass.stone-pounds',
    measures: [measure('units.mass.stone'), measure('units.mass.pound'), measure('units.mass.ounce')],
    per: [14, 16],
  },
  {
    id: 'units.mass.pounds-ounces',
    measures: [measure('units.mass.pound'), measure('units.mass.ounce')],
    per: [16],
  },
];
