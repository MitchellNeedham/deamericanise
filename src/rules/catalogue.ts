import { CONFIDENCES, matchesRuleId } from '../config.js';
import { dialectPack } from '../dialects/index.js';
import { ARTICLE_AGREEMENT } from '../engine/articles.js';
import type { Category, Confidence, Dialect, ResolvedOptions } from '../types.js';
import { patternRules } from './index.js';
import { spellingEntries } from './spelling/index.js';
import { MEASUREMENT_CONFIDENCE } from './units/index.js';
import { COMPOUNDS, MEASURES } from './units/definitions.js';
import { baseVocabulary } from './vocabulary.js';

/** A rule as someone choosing which rules to run needs to see it. */
export interface RuleInfo {
  id: string;
  category: Category;
  /** The tiers it runs under. With none of them ticked, it makes no changes. */
  confidence: Confidence[];
  /** A short name, such as `-ise endings`. */
  label: string;
  /** One change the rule makes, new form first, such as `organise for organize`. */
  example: string;
  /** Left alone in this dialect unless `rules` turns it on by id. */
  offByDefault: boolean;
  /**
   * False for a rule that only adjusts the changes other rules make. `rules` cannot
   * switch it off, and the change it adjusts goes with it.
   */
  switchable: boolean;
}

const LABELS: Record<string, [label: string, example: string]> = {
  'currency.disambiguate': ['US dollars', 'US$500 for $500'],
  'dates.long': ['Long dates', '5 March 2024 for March 5, 2024'],
  'dates.numeric': ['Numeric dates', '2024-03-14 for 3/14/2024'],
  'dialect.en-AU': ['Australian words', 'esky for cooler'],
  'dialect.en-GB': ['British words', 'lorry for truck'],
  'dialect.en-IE': ['Irish words', '112 for 911'],
  'dialect.en-NZ': ['New Zealand words', 'jandals for flip flops'],
  'dialect.en-ZA': ['South African words', 'bakkie for pickup truck'],
  'grammar.article-agreement': ['Articles', 'a rubber for an eraser'],
  'misc.paper-size': ['Paper sizes', 'A4 for US Letter'],
  'punctuation.abbreviations': ['Full stops in abbreviations', 'Mr Smith in the US for Mr. Smith in the U.S.'],
  'punctuation.logical-quotes': ['Full stops outside quotes', '"hello". for "hello."'],
  'spelling.contextual.cheque': ['Cheque, for money', 'chequebook for checkbook'],
  'spelling.contextual.disc': ['Disc, outside computing', 'disc brake for disk brake'],
  'spelling.contextual.draught': ['Draught, for beer and air', 'draught beer for draft beer'],
  'spelling.contextual.gotten': ['Got', 'had got for had gotten'],
  'spelling.contextual.judgement': ['Judgement, outside law', 'judgement for judgment'],
  'spelling.contextual.kerb': ['Kerb, for the edge of a road', 'kerbside for curbside'],
  'spelling.contextual.licence': ['Licence, the noun', 'a licence for a license'],
  'spelling.contextual.metre': ['Metre, the length', '400 metres for 400 meters'],
  'spelling.contextual.practise': ['Practise, the verb', 'we practise for we practice'],
  'spelling.contextual.storey': ['Storey, for a level of a building', 'two-storey for two story'],
  'spelling.contextual.tyre': ['Tyre, on a wheel', 'tyre pressure for tire pressure'],
  'spelling.contextual.vice': ['Vice, the clamp', 'bench vice for bench vise'],
  'spelling.digraph': ['ae and oe', 'anaesthesia for anesthesia'],
  'spelling.double-l': ['Doubled l', 'travelled for traveled'],
  'spelling.ence': ['-ence endings', 'defence for defense'],
  'spelling.irregular': ['One-off spellings', 'aluminium for aluminum'],
  'spelling.irregular-ambiguous': ['Grey', 'grey for gray'],
  'spelling.irregular-technical': ['Technical one-offs', 'foetus for fetus'],
  'spelling.ise': ['-ise endings', 'organise for organize'],
  'spelling.metre': ['-metre and -litre', 'kilometre for kilometer'],
  'spelling.ogue': ['-ogue endings', 'catalogue for catalog'],
  'spelling.ogue-technical': ['-ogue in technical words', 'dialogue for dialog'],
  'spelling.our': ['-our endings', 'colour for color'],
  'spelling.practise': ['Practised and practising', 'practised for practiced'],
  'spelling.re': ['-re endings', 'centre for center'],
  'spelling.single-l': ['Single l', 'enrolment for enrollment'],
  'spelling.yse': ['-yse endings', 'analyse for analyze'],
  'times.clock': ['Clock times', '3:00pm for 3:00 P.M.'],
  'units.area.acre': ['Acres', '4 hectares for 10 acres'],
  'units.area.square-foot': ['Square feet', '93 square metres for 1,000 square feet'],
  'units.area.square-mile': ['Square miles', '13 square kilometres for 5 square miles'],
  'units.dimensions': ['Dimensions', '3 x 3.7 metres for 10 x 12 feet'],
  'units.economy.mpg': ['Fuel economy', '7.8 L/100km for 30 mpg'],
  'units.energy.btu': ['BTUs', '13,000 kJ for 12,000 BTU'],
  'units.length.coin': ['Coin sizes', '24 mm hail for quarter-sized hail'],
  'units.length.fathom': ['Fathoms', '18 metres for 10 fathoms'],
  'units.length.feet-inches': ['Feet and inches', '1.88 metres for 6 feet 2 inches'],
  'units.length.foot': ['Feet', '1.8 metres for 6 feet'],
  'units.length.inch': ['Inches', '5.1 centimetres for 2 inches'],
  'units.length.mile': ['Miles', '16 kilometres for 10 miles'],
  'units.length.yard': ['Yards', '91 metres for 100 yards'],
  'units.mass.ounce': ['Ounces', '230 grams for 8 ounces'],
  'units.mass.pound': ['Pounds', '82 kilograms for 180 pounds'],
  'units.mass.pounds-ounces': ['Pounds and ounces', '3.4 kilograms for 7 pounds 8 ounces'],
  'units.mass.stone': ['Stone', '76 kilograms for 12 stone'],
  'units.mass.stone-pounds': ['Stone and pounds', '71.7 kilograms for 11 stone 4 pounds'],
  'units.mass.ton': ['Tons', '1.8 tonnes for 2 tons'],
  'units.mass.troy-ounce': ['Troy ounces', '62 grams for 2 troy ounces'],
  'units.measurement': ['Single measurements', '1.8 metres for 6 feet'],
  'units.power.horsepower': ['Horsepower', '220 kilowatts for 300 horsepower'],
  'units.power.refrigeration-ton': ['Tons of cooling', '11 kilowatts for 3 tons of refrigeration'],
  'units.pressure.inhg': ['Inches of mercury', '1013 hPa for 29.92 inHg'],
  'units.pressure.psi': ['Pounds per square inch', '220 kPa for 32 psi'],
  'units.range': ['Ranges', '1.5-3 metres for 5-10 feet'],
  'units.speed.mph': ['Miles per hour', '97 km/h for 60 mph'],
  'units.temperature.decade': ['Temperatures in decades', 'between 32 and 37°C for in the 90s'],
  'units.temperature.difference': ['Temperature changes', '11°C warmer for 20°F warmer'],
  'units.temperature.fahrenheit': ['Fahrenheit', '175°C for 350°F'],
  'units.thermal.r-value': ['R-values', '0.44 m²·K/W for 2.5 ft²·h·°F/BTU'],
  'units.thermal.u-factor': ['U-factors', '1.7 W/(m²·K) for 0.30 BTU/h·ft²·°F'],
  'units.torque.foot-pound': ['Foot-pounds', '140 newton metres for 100 foot-pounds'],
  'units.volume.cubic-foot': ['Cubic feet', '280 litres for 10 cubic feet'],
  'units.volume.cup': ['Cups', '470 millilitres for 2 cups'],
  'units.volume.fluid-ounce': ['Fluid ounces', '240 millilitres for 8 fluid ounces'],
  'units.volume.gallon': ['Gallons', '3.8 litres for 1 gallon'],
  'units.volume.pint': ['Pints', '470 millilitres for 1 pint'],
  'units.volume.quart': ['Quarts', '950 millilitres for 1 quart'],
  'units.volume.tablespoon': ['Tablespoons', '30 millilitres for 2 tablespoons'],
  'units.volume.teaspoon': ['Teaspoons', '4.9 millilitres for 1 teaspoon'],
  'vocabulary.clothing': ['Clothing', 'jumper for sweater'],
  'vocabulary.contextual.autumn': ['Autumn, the season', 'in the autumn of 2024 for in the fall of 2024'],
  'vocabulary.contextual.bill': ['Bill, at a restaurant', 'pay the bill for pay the check'],
  'vocabulary.contextual.full-stop': ['Full stop, the punctuation mark', 'a full stop for a period'],
  'vocabulary.contextual.petrol': ['Petrol, the fuel', 'buying petrol for buying gas'],
  'vocabulary.contextual.queue': ['Queue', 'in the queue for in line'],
  'vocabulary.contextual.rubbish': ['Rubbish', 'take out the rubbish for take out the trash'],
  'vocabulary.contextual.storeys': ['Floor numbers', 'ground floor for first floor'],
  'vocabulary.education': ['School and university', 'first-year student for freshman'],
  'vocabulary.everyday': ['Everyday words', 'lift for elevator'],
  'vocabulary.food': ['Food', 'coriander for cilantro'],
  'vocabulary.grades': ['School years', 'Year 5 for 5th grade'],
  'vocabulary.household': ['Household', 'tap for faucet'],
  'vocabulary.motoring': ['Motoring', 'petrol station for gas station'],
};

/** Every rule the package can run in a dialect, sorted by id. */
export function ruleCatalogue(dialect: Dialect = 'en-AU'): RuleInfo[] {
  const pack = dialectPack(dialect);
  const found = new Map<string, { category: Category; confidence: Set<Confidence>; kept: boolean }>();

  const add = (id: string, category: Category, confidence: Confidence, kept = false): void => {
    const known = found.get(id);
    if (!known) {
      found.set(id, { category, confidence: new Set([confidence]), kept });
      return;
    }
    if (known.category !== category) {
      throw new Error(`Rule ${id} is in both ${known.category} and ${category}.`);
    }
    known.confidence.add(confidence);
    known.kept ||= kept;
  };

  for (const entry of [...spellingEntries(), ...baseVocabulary(), ...pack.vocabulary]) {
    add(entry.ruleId, entry.category, entry.confidence);
  }
  // The rule list does not depend on these options, only which units each rule matches.
  const options = { dialect, unitsKeep: [], rules: {} } as unknown as ResolvedOptions;
  for (const rule of patternRules(options)) add(rule.id, rule.category, rule.confidence);
  for (const measure of MEASURES) {
    const kept = measure.keptByDefault === true || pack.unitsKeep.includes(measure.keep);
    add(measure.id, 'units', MEASUREMENT_CONFIDENCE, kept);
  }
  // A compound in a kept unit is held whole, so it converts only when turned on by id.
  for (const compound of COMPOUNDS) {
    const kept = compound.measures.some(
      (measure) => measure.keptByDefault === true || pack.unitsKeep.includes(measure.keep),
    );
    add(compound.id, 'units', MEASUREMENT_CONFIDENCE, kept);
  }
  add(ARTICLE_AGREEMENT.ruleId, ARTICLE_AGREEMENT.category, ARTICLE_AGREEMENT.confidence);

  return [...found.keys()].sort().map((id) => {
    const { category, confidence, kept } = found.get(id)!;
    const [label, example] = LABELS[id] ?? [id, ''];
    return {
      id,
      category,
      confidence: CONFIDENCES.filter((c) => confidence.has(c)),
      label,
      example,
      offByDefault: kept || pack.disable.some((pattern) => matchesRuleId(pattern, id)),
      switchable: id !== ARTICLE_AGREEMENT.ruleId,
    };
  });
}

/** Every rule id the package can emit, for documentation and for `--explain`. */
export function ruleIds(dialect: Dialect = 'en-AU'): string[] {
  return ruleCatalogue(dialect).map((rule) => rule.id);
}
