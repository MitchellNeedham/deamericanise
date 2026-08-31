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
  convert(value: number): MetricValue;
  /**
   * Contexts where the imperial unit is the worldwide convention: screens are sold in
   * inches everywhere, so are wheels, pipes and vinyl.
   */
  conventional?: { before?: RegExp; after?: RegExp };
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

/** Screens, wheels, pipes and records are sized in inches the world over. */
const INCH_CONVENTIONS = {
  before:
    /\b(?:screen|display|monitor|laptop|tablet|phone|tv|television|panel|wheel|wheels|rim|rims|tyre|tire|pipe|pipes|bore|vinyl|record|drive|disk|disc|barrel|waist|chest|inseam|sensor|lens|nail|nails)\b[\s-]*(?:of\s+)?$/i,
  after:
    /^[\s-]*(?:screen|display|monitor|laptop|tablet|macbook|tv|television|panel|wheels?|rims?|tyres?|tires?|pipes?|vinyl|records?|drive|disk|disc|floppy|barrel|sensor|lens|nails?|pizza|subwoofer|speaker)\b/i,
};

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
    abbrevs: ['in.', 'in', '″', '"'],
    convert: (v) => metricLength(v * 0.0254),
    conventional: INCH_CONVENTIONS,
  },
  {
    id: 'units.length.foot',
    keep: 'foot',
    words: ['feet', 'foot'],
    abbrevs: ['ft.', 'ft', '′'],
    convert: (v) => metricLength(v * 0.3048),
  },
  {
    id: 'units.length.yard',
    keep: 'yard',
    words: ['yards', 'yard'],
    abbrevs: ['yds', 'yd'],
    convert: (v) => metricLength(v * 0.9144),
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
  },
  {
    id: 'units.mass.stone',
    keep: 'stone',
    words: ['stone'],
    abbrevs: [],
    convert: (v) => metricMass(v * 6350.29318),
  },
  {
    id: 'units.mass.ton',
    keep: 'ton',
    words: ['tons', 'ton'],
    abbrevs: [],
    convert: (v) => metricMass(v * 907_184.74),
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
    id: 'units.volume.cup',
    keep: 'cup',
    words: ['cups', 'cup'],
    abbrevs: [],
    convert: (v) => metricVolume(v * 236.5882365),
  },
  {
    id: 'units.volume.tablespoon',
    keep: 'tablespoon',
    words: ['tablespoons', 'tablespoon'],
    abbrevs: ['tbsp', 'tbs'],
    convert: (v) => metricVolume(v * 14.78676478),
  },
  {
    id: 'units.volume.teaspoon',
    keep: 'teaspoon',
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
    words: ['foot-pounds', 'foot pounds', 'foot-pound', 'pound-feet'],
    abbrevs: ['ft-lb', 'ft-lbs', 'lb-ft'],
    convert: (v) => m(v * 1.3558179483, 'N·m', 'newton metre', 'newton metres'),
  },
];
