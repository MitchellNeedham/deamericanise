import type { Confidence, LexEntry } from '../types.js';

/**
 * Words that are American rather than merely spelt the American way. Everything here
 * is shared by every non-US dialect; anything that differs between Australia, Britain
 * and New Zealand lives in the dialect overlays instead.
 */

type Row = [from: string, to: string];

function set(ruleId: string, confidence: Confidence, rows: Row[]): LexEntry[] {
  return rows.map(([from, to]) => ({
    from,
    to,
    ruleId,
    category: 'vocabulary' as const,
    confidence,
  }));
}

const MOTORING: Row[] = [
  ['gasoline', 'petrol'],
  ['gas station', 'petrol station'],
  ['gas stations', 'petrol stations'],
  ['gas pump', 'petrol pump'],
  ['gas pumps', 'petrol pumps'],
  ['gas tank', 'petrol tank'],
  ['gas cap', 'petrol cap'],
  ['gas can', 'petrol can'],
  ['gas prices', 'petrol prices'],
  ['gas price', 'petrol price'],
  ['gas mileage', 'fuel consumption'],
  ['gas pedal', 'accelerator'],
  ['out of gas', 'out of petrol'],
  ['pump gas', 'fill up'],
  ['gas gauge', 'fuel gauge'],
  ['windshield', 'windscreen'],
  ['windshields', 'windscreens'],
  ['windshield wiper', 'windscreen wiper'],
  ['windshield wipers', 'windscreen wipers'],
  ['turn signal', 'indicator'],
  ['turn signals', 'indicators'],
  ['blinker', 'indicator'],
  ['blinkers', 'indicators'],
  ['muffler', 'exhaust'],
  ['mufflers', 'exhausts'],
  ['stick shift', 'manual'],
  ['gearshift', 'gear stick'],
  ['emergency brake', 'handbrake'],
  ['parking brake', 'handbrake'],
  ['license plate', 'number plate'],
  ['license plates', 'number plates'],
  ['parking lot', 'car park'],
  ['parking lots', 'car parks'],
  ['parking garage', 'car park'],
  ['crosswalk', 'pedestrian crossing'],
  ['crosswalks', 'pedestrian crossings'],
  ['railroad', 'railway'],
  ['railroads', 'railways'],
  ['railroad crossing', 'level crossing'],
  ['divided highway', 'dual carriageway'],
  ['tractor trailer', 'semi-trailer'],
  ['semi truck', 'semi-trailer'],
  ['recreational vehicle', 'campervan'],
  ['driver license', 'driver licence'],
  ['drivers license', 'driver licence'],
  ["driver's license", 'driver licence'],
];

const FOOD: Row[] = [
  ['french fries', 'chips'],
  ['cilantro', 'coriander'],
  ['arugula', 'rocket'],
  ['ground beef', 'beef mince'],
  ['ground meat', 'mince'],
  ['ground pork', 'pork mince'],
  ['confectioners sugar', 'icing sugar'],
  ["confectioner's sugar", 'icing sugar'],
  ['powdered sugar', 'icing sugar'],
  ['all-purpose flour', 'plain flour'],
  ['all purpose flour', 'plain flour'],
  ['baking soda', 'bicarbonate of soda'],
  ['scallion', 'spring onion'],
  ['scallions', 'spring onions'],
  ['green onion', 'spring onion'],
  ['green onions', 'spring onions'],
  ['jello', 'jelly'],
  ['takeout', 'takeaway'],
  ['take-out', 'takeaway'],
  ['broil', 'grill'],
  ['broiled', 'grilled'],
  ['broiler', 'grill'],
  ['skillet', 'frying pan'],
  ['skillets', 'frying pans'],
  ['silverware', 'cutlery'],
  ['soda pop', 'soft drink'],
  ['grocery store', 'supermarket'],
  ['grocery stores', 'supermarkets'],
];

const HOUSEHOLD: Row[] = [
  ['faucet', 'tap'],
  ['faucets', 'taps'],
  ['garbage can', 'rubbish bin'],
  ['garbage cans', 'rubbish bins'],
  ['trash can', 'rubbish bin'],
  ['trash cans', 'rubbish bins'],
  ['garbage truck', 'rubbish truck'],
  ['garbage disposal', 'waste disposal unit'],
  ['dumpster', 'skip'],
  ['dumpsters', 'skips'],
  ['closet', 'wardrobe'],
  ['closets', 'wardrobes'],
  ['drapes', 'curtains'],
  ['flashlight', 'torch'],
  ['flashlights', 'torches'],
  ['eraser', 'rubber'],
  ['erasers', 'rubbers'],
  ['thumbtack', 'drawing pin'],
  ['thumbtacks', 'drawing pins'],
  ['scotch tape', 'sticky tape'],
  ['q-tip', 'cotton bud'],
  ['q-tips', 'cotton buds'],
  ['diaper', 'nappy'],
  ['diapers', 'nappies'],
  ['pacifier', 'dummy'],
  ['pacifiers', 'dummies'],
  ['stroller', 'pram'],
  ['strollers', 'prams'],
  ['crib', 'cot'],
  ['aluminum foil', 'aluminium foil'],
  ['shopping cart', 'trolley'],
  ['shopping carts', 'trolleys'],
  ['apartment building', 'apartment block'],
  ['baby carriage', 'pram'],
];

const CLOTHING: Row[] = [
  ['sweater', 'jumper'],
  ['sweaters', 'jumpers'],
  ['suspenders', 'braces'],
  ['pantyhose', 'stockings'],
  ['fanny pack', 'bum bag'],
  ['fanny packs', 'bum bags'],
  ['bangs', 'fringe'],
];

const EVERYDAY: Row[] = [
  ['elevator', 'lift'],
  ['elevators', 'lifts'],
  ['cell phone', 'mobile phone'],
  ['cell phones', 'mobile phones'],
  ['cellphone', 'mobile phone'],
  ['cellphones', 'mobile phones'],
  ['cell number', 'mobile number'],
  ['vacation', 'holiday'],
  ['vacations', 'holidays'],
  ['vacationing', 'holidaying'],
  ['movie theater', 'cinema'],
  ['movie theaters', 'cinemas'],
  ['zip code', 'postcode'],
  ['zip codes', 'postcodes'],
  ['drugstore', 'chemist'],
  ['drugstores', 'chemists'],
  ['realtor', 'real estate agent'],
  ['realtors', 'real estate agents'],
  ['real estate broker', 'real estate agent'],
  ['mailman', 'postie'],
  ['mailmen', 'posties'],
  ['mail carrier', 'postie'],
  ['mailbox', 'letterbox'],
  ['mailboxes', 'letterboxes'],
  ['pound sign', 'hash'],
  ['number sign', 'hash'],
  ['period key', 'full stop key'],
  ['restroom', 'toilet'],
  ['restrooms', 'toilets'],
  ['checkers', 'draughts'],
  ['tic-tac-toe', 'noughts and crosses'],
  ['jump rope', 'skipping rope'],
  ['trailer park', 'caravan park'],
];

const EDUCATION: Row[] = [
  ['freshman', 'first-year student'],
  ['freshmen', 'first-year students'],
  ['sophomore', 'second-year student'],
  ['sophomores', 'second-year students'],
  ['report card', 'report'],
  ['recess', 'lunch break'],
  ['field trip', 'excursion'],
  ['field trips', 'excursions'],
  ['grade school', 'primary school'],
  ['elementary school', 'primary school'],
  ['public school', 'state school'],
  ['tuition', 'tuition fees'],
];

/** Gated on their surroundings because the same word has an innocent sense. */
const CONTEXTUAL: LexEntry[] = [
  {
    from: 'gas',
    to: 'petrol',
    ruleId: 'vocabulary.contextual.petrol',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore: /\b(?:pumping|pumped|buy|bought|buying|cheap|expensive|more|less|free|the price of|a tank of|full of|filled with)\s+$/i,
    forbidAfter: /^\s+(?:giant|cloud|leak|leaks|line|lines|main|mains|chamber|law|laws|constant|molecule|phase|state)\b/i,
  },
  ...[
    // `last fall`, `this fall`: the determiner alone settles it.
    /\b(?:last|this|next|each|every)\s+$/i,
    // `in the fall`, `since the fall`.
    /\b(?:in|during|since|by|before|after|through|throughout)\s+the\s+$/i,
  ].map((requireBefore): LexEntry => ({
    from: 'fall',
    to: 'autumn',
    ruleId: 'vocabulary.contextual.autumn',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore,
    forbidAfter: /^\s*(?:\?|in\b|by\b|to\b|below\b|short\b|apart\b|behind\b|through\b)/i,
  })),
  {
    from: 'fall',
    to: 'autumn',
    ruleId: 'vocabulary.contextual.autumn',
    category: 'vocabulary',
    confidence: 'risky',
    requireAfter: /^\s+(?:of\s+)?(?:19|20)\d\d\b|^\s+(?:semester|term|season|harvest|foliage|colou?rs?)\b/i,
  },
  {
    from: 'trash',
    to: 'rubbish',
    ruleId: 'vocabulary.contextual.rubbish',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore: /\b(?:take out the|took out the|the|put the|throw the|collect the|household|curbside|kerbside)\s+$/i,
  },
  {
    from: 'check',
    to: 'bill',
    ruleId: 'vocabulary.contextual.bill',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore: /\b(?:the|our|my|split the|pay the|paid the|ask for the|got the)\s+$/i,
    requireAfter: /^[,.!?]?\s*(?:please|at the restaurant|when|$)/i,
  },
  {
    from: 'in line',
    to: 'in the queue',
    ruleId: 'vocabulary.contextual.queue',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore: /\b(?:wait|waiting|waited|stand|standing|stood|first|next|ahead|behind)\s+$/i,
  },
  {
    from: 'period',
    to: 'full stop',
    ruleId: 'vocabulary.contextual.full-stop',
    category: 'vocabulary',
    confidence: 'risky',
    requireBefore: /\b(?:a|the|with a|ends? with a|followed by a|add a|insert a|trailing)\s+$/i,
    requireAfter: /^\s*(?:[,.)]|\s(?:instead|rather|character|at the end|and|or)\b)/i,
  },
  {
    from: 'first floor',
    to: 'ground floor',
    ruleId: 'vocabulary.contextual.storeys',
    category: 'vocabulary',
    confidence: 'risky',
    note: 'American first floor is the ground floor elsewhere, which shifts every floor above it',
  },
];

/** `5th grade` -> `Year 5`. */
const GRADES: LexEntry[] = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => {
  const ordinal =
    n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  const word = [
    'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
    'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
  ][n - 1]!;
  return [`${ordinal} grade`, `${word} grade`, `grade ${n}`].map(
    (from): LexEntry => ({
      from,
      to: `Year ${n}`,
      ruleId: 'vocabulary.grades',
      category: 'vocabulary',
      confidence: 'moderate',
    }),
  );
});

export function baseVocabulary(): LexEntry[] {
  return [
    ...set('vocabulary.motoring', 'moderate', MOTORING),
    ...set('vocabulary.food', 'moderate', FOOD),
    ...set('vocabulary.household', 'moderate', HOUSEHOLD),
    ...set('vocabulary.clothing', 'moderate', CLOTHING),
    ...set('vocabulary.everyday', 'moderate', EVERYDAY),
    ...set('vocabulary.education', 'risky', EDUCATION),
    ...GRADES,
    ...CONTEXTUAL.map((entry) => ({ ...entry, priority: 20 })),
  ];
}
