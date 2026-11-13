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
  /**
   * The forms in `words` that are only ever singular, as `inch` is. A form that is its own
   * plural, as `stone` is, is not one.
   */
  singular: string[];
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
   * inches everywhere, so are wheels, pipes and vinyl. A measurement in any one of them
   * is left as written.
   */
  conventional?: Convention | Convention[];
  /**
   * Skip this measure entirely when the document matches. For units whose name means
   * different things in different places, the document usually says which it means.
   */
  ambiguousWhen?: RegExp;
  /**
   * Where the written-out unit in the quantity `text.slice(start, end)` is being used in
   * another sense, such as `pounds` for money or the `pound` of `pound cake`, the end of what
   * that sense covers: `end` for money, and the end of the noun for `pound cake`. Null where
   * the unit is a measurement. Checked whatever `respectConventions` says, because what it
   * finds is not a measurement at all.
   */
  otherSense?: (text: string, start: number, end: number) => number | null;
  /**
   * Left alone unless the rule is turned on by id. For measures that are not American at
   * all, merely imperial-descended and used everywhere.
   */
  keptByDefault?: boolean;
  /**
   * Decimal places the metric value is written to under `natural` precision, whatever figures
   * the source gives, as an altimeter setting is read in whole hectopascals.
   */
  decimals?: number;
  /** Other things the unit may measure, told by the words beside the quantity, in the order tried. */
  senses?: Sense[];
}

/**
 * A sense in which a measure's unit measures something else, told by the words beside the
 * quantity: an ounce of milk is a fluid ounce, an ounce of gold a troy ounce, and the ton of
 * an air conditioner a rate of cooling. A metric value the author gives after the quantity
 * decides by its dimension. Otherwise what the quantity measures, after it, decides, and only
 * where nothing after it names a thing do the words before it count, and then its sentence.
 */
export interface Sense {
  /**
   * The id of the measure the quantity converts as. Without one, no conversion fits, and the
   * quantity is held as written, as the copper weight of a circuit board is.
   */
  as?: string;
  /** Says on each change made in this sense how the unit was read. */
  note?: string;
  /**
   * What the quantity measures or describes in this sense, in the phrase after the unit:
   * after an optional `of`, with at most two words between that are not function words, and
   * whatever follows, as `milk` in `Add 8 oz of whole milk slowly` and `AC` in
   * `a 3-ton central AC unit`.
   */
  things: string[];
  /**
   * Nouns one of `things` may describe, as `unit` in `AC units of 2 to 5 tons`, where they
   * stand between the thing and the number. One of `things` before one is its material, as
   * `glass` is in `a 16 oz glass jar`.
   */
  heads?: string[];
  /** Nouns read through to what they hold, as the `can` of `a 12 oz can of soda`. */
  vessels?: string[];
  /**
   * Names that hold one of `things` and are another thing, as `sour cream` and `cream cheese`
   * are solids.
   */
  except?: string[];
  /**
   * Words before the number that say so, with at most one of `heads` and three function words
   * between, as in `AC units of 2 to 5 tons`.
   */
  before?: string[];
  /** Words that say so anywhere in the quantity's sentence, as `PCB` does. */
  sentence?: string[];
}

/** A context where a unit is the worldwide convention, read around one measurement. */
export interface Convention {
  /** Matches the text that ends where the measurement starts. */
  before?: RegExp;
  /** Matches the text that starts where the measurement ends. */
  after?: RegExp;
  /**
   * Matches the text after the measurement when that text makes it a distance or a position,
   * as `apart` does in `the bolts 6 inches apart`. The convention then does not hold, whatever
   * `before` and `after` find, since the thing named is what the distance runs from.
   */
  distance?: RegExp;
  /**
   * The only values the convention holds, as a shipping container's standard lengths are.
   * Every figure of a range or dimension must be one of them.
   */
  values?: readonly number[];
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
const SIZED_IN_INCHES = [
  'screen', 'display', 'monitor', 'touchscreen', 'laptop', 'tablet', 'phone', 'macbook', 'tv',
  'television', 'panel', 'wheel', 'rim', 'tyre', 'tire', 'pipe', 'bore', 'vinyl', 'record',
  'drive', 'disk', 'disc', 'floppy', 'ssd', 'hdd', 'sata', 'nvme', 'barrel', 'sensor', 'lens',
  'pizza', 'subwoofer', 'speaker', 'jack', 'plug', 'trs', 'trrs', 'phono', 'eyepiece',
  'telescope', 'dobsonian', 'refractor', 'reflector', 'focuser', 'aperture',
  'nail', 'bolt', 'screw', 'nut', 'washer', 'socket', 'wrench', 'spanner', 'thread', 'hex',
  'ratchet', 'rivet', 'stud', 'dowel', 'tap', 'fitting', 'coupling', 'nipple', 'union', 'elbow',
  'npt', 'unc', 'unf', 'drill', 'bit',
];

/**
 * A body is measured as well as sized, as in `2 inches off your waist`, so a part of it names
 * a size only before the size.
 */
const BODY_SIZED_IN_INCHES = ['waist', 'chest', 'inseam'];

/**
 * Plurals that are also verbs of measuring, as in `the gauge records 2 inches of rain`, so
 * they name a thing only after its size.
 */
const MEASURING_VERBS = new Set(['records', 'drives', 'drills', 'bores']);

/**
 * Nouns that are also verbs taking what is sized as their object, as in `plug the 2 inch
 * hole`, so they name a thing only after its size.
 */
const SIZING_VERBS = new Set(['plug', 'plugs', 'jack', 'jacks']);

/** Words after a measurement that make it a distance or a position, as in `6 inches apart`. */
const DISTANCE_WORDS = ['away', 'apart', 'off', 'above', 'below', 'behind', 'beneath', 'from'];

/**
 * One of `DISTANCE_WORDS`, whole, so `off-white` is none. `from` and then `<word> to <word>`
 * spans the thing itself, so `27 inches from corner to corner` gives a size.
 */
const DISTANCE =
  String.raw`(?!from\s+[\w-]+\s+to\s+[\w-])(?:${DISTANCE_WORDS.join('|')})(?![\w-])`;

const plural = (noun: string): string =>
  /(?:s|x|ch|sh)$/.test(noun)
    ? `${noun}es`
    : /[^aeiou]y$/.test(noun)
      ? `${noun.slice(0, -1)}ies`
      : `${noun}s`;

const withPlurals = (nouns: string[]): string[] => nouns.flatMap((noun) => [noun, plural(noun)]);

const INCH_CONVENTIONS: Convention = {
  // A few function words may sit between the thing and its size. A bolt described as up
  // to an inch in diameter is being named; a bolt described as standing away from a wall
  // is being measured. Allowing only function words between the two keeps them apart.
  before: new RegExp(
    String.raw`\b(?:${withPlurals([...SIZED_IN_INCHES, ...BODY_SIZED_IN_INCHES])
      .filter((noun) => !MEASURING_VERBS.has(noun) && !SIZING_VERBS.has(noun))
      .join('|')})\b` +
      String.raw`(?:\s+(?:up|to|above|below|over|under|of|and|or|the|a|an|about|approximately|` +
      String.raw`larger|smaller|greater|less|than|from|in|is|are|measuring|between)){0,4}[\s-]*$`,
    'i',
  ),
  // Up to three words may sit between the measurement and the thing measured, as in
  // `a 12-inch capacitive LCD touchscreen`.
  after: new RegExp(
    String.raw`^[\s-]*(?:[\w-]+\s+){0,3}(?:${withPlurals(SIZED_IN_INCHES).join('|')})\b`,
    'i',
  ),
  distance: new RegExp(String.raw`^[\s-]*${DISTANCE}`, 'i'),
};

/**
 * Words that cannot stand between a size and the thing it sizes, as `the` does in
 * `20 feet towards the container`: a determiner or a preposition starts another phrase.
 */
const NOT_A_MODIFIER = [
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'its', 'their', 'his', 'her', 'my', 'our',
  'your', 'of', 'to', 'toward', 'towards', 'into', 'onto', 'at', 'by', 'for', 'in', 'on', 'with',
  'near', 'past', 'beside', 'between',
];

/**
 * Shipping containers are named by their length in feet in every port, metric or not, and
 * only the standard lengths name one. The TEU, a twenty-foot equivalent unit, counts them.
 */
const CONTAINER: Convention = {
  after: new RegExp(
    String.raw`^[\s-]*(?:(?!(?:${NOT_A_MODIFIER.join('|')})(?![\w-])|${DISTANCE})[\w-]+\s+){0,2}` +
      String.raw`(?:containers?|(?:shipping|ISO|high[\s-]cube|reefer|dry|intermodal)\s+box(?:es)?|` +
      String.raw`TEU|FEU|equivalent\s+units?)\b`,
    'i',
  ),
  values: [10, 20, 40, 45, 48, 53],
};

/**
 * Aviation gives altitudes in feet in nearly every country: on charts, in flight levels and
 * from air traffic control. A room has a ceiling too, so only an aircraft's or a cloud
 * layer's counts.
 */
const AVIATION =
  String.raw`flight\s+level|cruis(?:e|ing)\s+altitude|(?:service|absolute|cloud)\s+ceiling`;

// A stop ends the sentence unless a digit follows it, as in `Mach 0.85`.
const IN_SENTENCE = String.raw`(?:[^.!?\n]|\.(?=\d))*`;

const ALTITUDE: Convention[] = [
  { after: /^\s*(?:MSL|AMSL|AGL|QNH|QFE)\b/i },
  {
    before: new RegExp(String.raw`\b(?:${AVIATION})\b${IN_SENTENCE}$`, 'i'),
    after: new RegExp(String.raw`^${IN_SENTENCE}\b(?:${AVIATION})\b`, 'i'),
  },
];

/**
 * Where the noun ends that the singular unit word `word`, ending the quantity
 * `text.slice(start, end)`, is the first part of, as `pound` is in `Bake 1 pound cake`, or
 * null where `nouns` finds none after it. The number then counts the noun. A hyphen ties a
 * unit to its number, so `a 2-pound cake` is a weight.
 */
function startsNoun(word: string, nouns: RegExp) {
  const unit = new RegExp(String.raw`(?<![-A-Za-z])${word}$`, 'i');
  return (text: string, start: number, end: number): number | null => {
    if (!unit.test(text.slice(start, end))) return null;
    const noun = nouns.exec(text.slice(end, end + 40));
    return noun === null ? null : end + noun[0].length;
  };
}

const poundNoun = startsNoun('pound', /^[\s-]+(?:cakes?|signs?)\b/i);

/** Drinks and other liquids, which American labels and recipes measure in ounces by volume. */
const LIQUIDS = [
  'water', 'milk', 'buttermilk', 'half-and-half', 'cream', 'juice', 'lemonade', 'soda', 'cola',
  'seltzer', 'tonic', 'coffee', 'espresso', 'broth', 'stock', 'oil', 'vinegar', 'syrup', 'liquid',
  'drink', 'beer', 'ale', 'lager', 'cider', 'wine', 'champagne', 'sherry', 'vermouth', 'sake',
  'liquor', 'liqueur', 'whiskey', 'whisky', 'bourbon', 'vodka', 'gin', 'rum', 'tequila', 'brandy',
  'cognac',
];

/** Vessels that only ever hold a drink. */
const DRINKWARE = ['glass', 'mug', 'tumbler', 'pint', 'shot'];

/** Vessels that hold food as often, which is weighed, as `a 15 oz can of beans` is. */
const VESSELS = ['can', 'bottle', 'cup', 'carton', 'jug', 'jar', 'keg', 'pitcher', 'flask', 'carafe'];

/** Solids named for a liquid. */
const NOT_LIQUIDS = withPlurals([
  'sour cream', 'ice cream', 'whipped cream', 'clotted cream', 'cream cheese', 'cream puff',
  'cream cracker', 'milk chocolate', 'milk powder', 'powdered milk', 'dried milk', 'dry milk',
  'condensed milk', 'baking soda', 'caustic soda', 'washing soda', 'soda cracker', 'soda bread',
  'ground coffee', 'instant coffee', 'bean coffee', 'coffee bean', 'coffee ground', 'coffee cake',
  'water chestnut', 'water cracker', 'beer bread', 'rum cake', 'rum ball', 'wine gum', 'stock cube',
  'oil paint',
]);

const FLUID_OUNCES: Sense = {
  as: 'units.volume.fluid-ounce',
  note: 'read as fluid ounces, since it measures a liquid',
  things: withPlurals([...LIQUIDS, ...DRINKWARE]),
  heads: withPlurals([...DRINKWARE, ...VESSELS, 'box']),
  vessels: withPlurals(VESSELS),
  except: NOT_LIQUIDS,
};

const TROY_OUNCES: Sense = {
  as: 'units.mass.troy-ounce',
  note: 'read as troy ounces, in which precious metals are weighed',
  things: ['gold', 'silver', 'platinum', 'palladium', 'bullion'],
  except: withPlurals(['silver polish', 'silver paint', 'gold paint', 'silver nitrate']),
};

/** A circuit board's copper, which boards are ordered by in ounces per square foot. */
const COPPER_WEIGHT: Sense = {
  things: ['copper', 'cu', 'cladding', 'copper clad'],
  heads: withPlurals(['weight', 'thickness', 'pour', 'layer', 'plane', 'trace', 'foil', 'plating', 'board', 'pcb']),
  except: withPlurals([
    'copper sulfate', 'copper sulphate', 'copper oxide', 'copper wire', 'copper pipe', 'copper tube',
  ]),
  before: ['copper', 'cu'],
  sentence: withPlurals(['pcb', 'fr-4', 'fr4', 'circuit board', 'printed circuit']),
};

/**
 * What a ton of cooling is the rating of. A ship's tonnage is a weight, so `tonnage` says
 * nothing. `cooling` and the compressor say so only after the quantity, since a block of
 * steel is cooled and a compressor weighed.
 */
const COOLED = [
  'ac', 'a/c', 'air conditioner', 'air conditioning', 'heat pump', 'condenser', 'chiller', 'hvac',
  'refrigeration', 'btu', 'seer', 'split system', 'mini split',
];

const TONS_OF_COOLING: Sense = {
  as: 'units.power.refrigeration-ton',
  note: 'read as tons of refrigeration, a rate of cooling',
  things: withPlurals([...COOLED, 'compressor', 'cooling']),
  heads: withPlurals([
    'unit', 'system', 'capacity', 'load', 'size', 'rating', 'tower', 'plant', 'equipment', 'coil',
  ]),
  except: withPlurals(['hvac truck', 'hvac van', 'ac adapter']),
  before: withPlurals(COOLED),
};

export const MEASURES: Measure[] = [
  // ----- length -----
  {
    id: 'units.length.inch',
    keep: 'inch',
    words: ['inches', 'inch'],
    singular: ['inch'],
    abbrevs: ['in.', 'in', '″', '"', '”'],
    convert: (v) => metricLength(v * 0.0254),
    conventional: INCH_CONVENTIONS,
    otherSense: startsNoun('inch', /^[\s-]+worms?\b/i),
  },
  {
    id: 'units.length.foot',
    keep: 'foot',
    words: ['feet', 'foot'],
    singular: ['foot'],
    abbrevs: ['ft.', 'ft', '′'],
    convert: (v) => metricLength(v * 0.3048),
    conventional: [CONTAINER, ...ALTITUDE],
    otherSense: startsNoun('foot', /^[\s-]+(?:soldiers?|traffic)\b/i),
  },
  {
    id: 'units.length.yard',
    keep: 'yard',
    words: ['yards', 'yard'],
    singular: ['yard'],
    abbrevs: ['yds', 'yd'],
    convert: (v) => metricLength(v * 0.9144),
    // A gridiron yard line and the 40 yard dash are names for things, not lengths. There
    // is no 37 metre line painted on any field.
    conventional: { after: /^[\s-]*(?:lines?|dash|markers?)\b/i },
    otherSense: startsNoun('yard', /^[\s-]+(?:sales?|signs?)\b/i),
  },
  {
    id: 'units.length.mile',
    keep: 'mile',
    words: ['miles', 'mile'],
    singular: ['mile'],
    abbrevs: ['mi'],
    convert: (v) => metricLength(v * 1609.344),
    // A mile marker is a post, so `the 26-mile marker` stands at mile 26 and is no length.
    conventional: { after: /^[\s-]*markers?\b/i },
    otherSense: startsNoun('mile', /^[\s-]+markers?\b/i),
  },
  {
    id: 'units.length.fathom',
    keep: 'fathom',
    words: ['fathoms', 'fathom'],
    singular: ['fathom'],
    abbrevs: [],
    convert: (v) => metricLength(v * 1.8288),
  },

  // ----- area -----
  {
    id: 'units.area.acre',
    keep: 'acre',
    words: ['acres', 'acre'],
    singular: ['acre'],
    abbrevs: [],
    convert: (v) => metricArea(v * 4046.856),
  },
  {
    id: 'units.area.square-foot',
    keep: 'square-foot',
    words: ['square feet', 'square foot', 'sq feet', 'sq foot'],
    singular: ['square foot', 'sq foot'],
    abbrevs: ['sq ft', 'sqft', 'ft²'],
    convert: (v) => metricArea(v * 0.09290304),
  },
  {
    id: 'units.area.square-mile',
    keep: 'square-mile',
    words: ['square miles', 'square mile', 'sq miles', 'sq mile'],
    singular: ['square mile', 'sq mile'],
    abbrevs: ['sq mi', 'mi²'],
    convert: (v) => metricArea(v * 2_589_988.11),
  },

  // ----- mass -----
  {
    id: 'units.mass.ounce',
    keep: 'ounce',
    words: ['ounces', 'ounce'],
    singular: ['ounce'],
    abbrevs: ['oz.', 'oz'],
    convert: (v) => metricMass(v * 28.349523125),
    senses: [FLUID_OUNCES, TROY_OUNCES, COPPER_WEIGHT],
  },
  {
    id: 'units.mass.troy-ounce',
    keep: 'troy-ounce',
    words: ['troy ounces', 'troy ounce'],
    singular: ['troy ounce'],
    abbrevs: ['troy oz', 'ozt', 'oz t'],
    convert: (v) => metricMass(v * 31.1034768),
  },
  {
    id: 'units.mass.pound',
    keep: 'pound',
    words: ['pounds', 'pound'],
    singular: ['pound'],
    abbrevs: ['lbs.', 'lbs', 'lb.', 'lb'],
    convert: (v) => metricMass(v * 453.59237),
    // Fighting weight classes are designations. The 147-pound division is called that
    // whatever the scales say in kilograms.
    conventional: {
      after: /^[\s-]*(?:divisions?|classes|class|limits?|bouts?|titles?|champions?|weight)\b/i,
    },
    otherSense: (text, start, end) =>
      isMoney(text, start, end) ? end : poundNoun(text, start, end),
  },
  {
    id: 'units.mass.stone',
    keep: 'stone',
    words: ['stone'],
    singular: [],
    abbrevs: [],
    compoundAbbrevs: ['st'],
    convert: (v) => metricMass(v * 6350.29318),
  },
  {
    id: 'units.mass.ton',
    keep: 'ton',
    words: ['tons', 'ton'],
    singular: ['ton'],
    abbrevs: [],
    // The US short ton. A document that also says `metric ton` or `tonne` is measuring in
    // those already, and reading its tons as short tons would be plainly wrong.
    convert: (v) => metricMass(v * 907_184.74),
    ambiguousWhen: /\b(?:metric\s+tons?|tonnes?|long\s+tons?)\b/i,
    senses: [TONS_OF_COOLING],
  },

  // ----- volume. Every one of these is the US measure, which is not the imperial one. -----
  {
    id: 'units.volume.fluid-ounce',
    keep: 'fluid-ounce',
    words: ['fluid ounces', 'fluid ounce'],
    singular: ['fluid ounce'],
    abbrevs: ['fl oz', 'fl. oz.', 'floz'],
    convert: (v) => metricVolume(v * 29.5735295625),
  },
  {
    id: 'units.volume.gallon',
    keep: 'gallon',
    words: ['gallons', 'gallon'],
    singular: ['gallon'],
    abbrevs: ['gal'],
    convert: (v) => metricVolume(v * 3785.411784),
  },
  {
    id: 'units.volume.quart',
    keep: 'quart',
    words: ['quarts', 'quart'],
    singular: ['quart'],
    abbrevs: ['qt'],
    convert: (v) => metricVolume(v * 946.352946),
  },
  {
    id: 'units.volume.pint',
    keep: 'pint',
    words: ['pints', 'pint'],
    singular: ['pint'],
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
    singular: ['cup'],
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
    singular: ['tablespoon'],
    abbrevs: ['tbsp', 'tbs'],
    convert: (v) => metricVolume(v * 14.78676478),
  },
  {
    // Universal in recipes, and 5 mL almost everywhere.
    id: 'units.volume.teaspoon',
    keep: 'teaspoon',
    keptByDefault: true,
    words: ['teaspoons', 'teaspoon'],
    singular: ['teaspoon'],
    abbrevs: ['tsp'],
    convert: (v) => metricVolume(v * 4.92892159),
  },
  {
    id: 'units.volume.cubic-foot',
    keep: 'cubic-foot',
    words: ['cubic feet', 'cubic foot'],
    singular: ['cubic foot'],
    abbrevs: ['cu ft', 'ft³'],
    convert: (v) => metricVolume(v * 28_316.8466),
  },

  // ----- speed, pressure, power, energy -----
  {
    id: 'units.speed.mph',
    keep: 'mph',
    words: ['miles per hour', 'miles an hour', 'mile per hour', 'mile an hour'],
    singular: ['mile per hour', 'mile an hour'],
    abbrevs: ['mph', 'MPH'],
    convert: (v) => m(v * 1.609344, 'km/h', 'kilometre per hour', 'kilometres per hour'),
  },
  {
    id: 'units.pressure.psi',
    keep: 'psi',
    words: ['pounds per square inch', 'pound per square inch'],
    singular: ['pound per square inch'],
    abbrevs: ['psi', 'PSI'],
    convert: (v) => m(v * 6.89475729, 'kPa', 'kilopascal', 'kilopascals'),
  },
  {
    id: 'units.pressure.inhg',
    keep: 'inhg',
    words: ['inches of mercury', 'inch of mercury'],
    singular: ['inch of mercury'],
    abbrevs: ['inHg', 'in. Hg', 'in Hg'],
    convert: (v) => m(v * 33.8639, 'hPa', 'hectopascal', 'hectopascals'),
    decimals: 0,
  },
  {
    id: 'units.power.horsepower',
    keep: 'horsepower',
    words: ['horsepower'],
    singular: [],
    abbrevs: ['hp'],
    convert: (v) => m(v * 0.745699872, 'kW', 'kilowatt', 'kilowatts'),
  },
  {
    // `12,000 BTU` an hour.
    id: 'units.power.refrigeration-ton',
    keep: 'refrigeration-ton',
    words: ['tons of refrigeration', 'ton of refrigeration'],
    singular: ['ton of refrigeration'],
    abbrevs: [],
    convert: (v) => m(v * 3.516852842, 'kW', 'kilowatt', 'kilowatts'),
  },
  {
    id: 'units.energy.btu',
    keep: 'btu',
    words: ['british thermal units', 'british thermal unit'],
    singular: ['british thermal unit'],
    abbrevs: ['BTU', 'BTUs'],
    convert: (v) => m(v * 1.05505585, 'kJ', 'kilojoule', 'kilojoules'),
  },
  {
    id: 'units.torque.foot-pound',
    keep: 'foot-pound',
    words: [
      'foot-pounds', 'foot pounds', 'foot-pound', 'foot pound', 'pound-feet', 'pound feet',
      'pound-foot', 'pound foot',
    ],
    singular: ['foot-pound', 'foot pound', 'pound-foot', 'pound foot'],
    // `lb ft` has to be listed, or the mass rule claims the number first and the
    // torque silently becomes a weight.
    abbrevs: ['ft-lb', 'ft-lbs', 'ft lb', 'ft lbs', 'lb-ft', 'lb ft', 'lbft', 'lb.ft'],
    convert: (v) => m(v * 1.3558179483, 'N·m', 'newton metre', 'newton metres'),
  },
];

/**
 * Word forms that are grammatically singular. A singular unit next to a number that is
 * not one is being used attributively (`a 9 inch dish`), and its replacement should stay
 * singular too.
 */
export const SINGULAR_WORDS = new Set(MEASURES.flatMap((measure) => measure.singular));

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
