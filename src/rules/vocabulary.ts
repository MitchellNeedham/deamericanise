import type { Confidence, LexEntry } from '../types.js';
import { IN_SENTENCE } from './sentence.js';

/**
 * Words that are American rather than merely spelt the American way. Everything here
 * is shared by every non-US dialect; anything that differs between Australia, Britain
 * and New Zealand lives in the dialect overlays instead.
 */

type Row = [from: string, to: string];

type Guard = Pick<LexEntry, 'requireBefore' | 'requireAfter' | 'forbidBefore' | 'forbidAfter'>;

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
  ['cookie sheet', 'baking tray'],
  ['cookie sheets', 'baking trays'],
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
  ['apartment buildings', 'apartment blocks'],
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
  ['trailer parks', 'caravan parks'],
  ['travel trailer', 'caravan'],
  ['travel trailers', 'caravans'],
  ['house trailer', 'caravan'],
  ['house trailers', 'caravans'],
  ['camping trailer', 'caravan'],
  ['camping trailers', 'caravans'],
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
    // Fuel, when something is being bought, burned or saved.
    requireBefore:
      /\b(?:pumping|pumped|pump|buy|bought|buying|cheap|cheaper|expensive|more|less|free|save|saves|saving|saved|waste|wastes|wasting|wasted|use|uses|using|used|conserve|burn|burns|burning|burned|burnt|the price of|the cost of|the amount of|a tank of|tank of|gallons of|litres of|liters of|full of|filled with|spend on|spent on|spending on|out of|on)\s+$/i,
    // Not fuel: the state of matter, the utility, the weapon, the emission.
    forbidBefore:
      /\b(?:natural|propane|butane|liquefied|liquified|lp|lpg|cng|lng|shale|coal|noble|inert|ideal|greenhouse|toxic|poison|tear|nerve|mustard|exhaust|flue|blood|arterial|anaesthetic|anesthetic|laughing|sour|flare|landfill|swamp|marsh|town|producer|water|synthesis|syn)\s+$/i,
    forbidAfter:
      /^\s+(?:giant|giants|cloud|clouds|leak|leaks|leakage|line|lines|main|mains|pipeline|pipelines|chamber|chambers|law|laws|constant|molecule|molecules|phase|phases|state|states|turbine|turbines|well|wells|field|fields|reserves|deposit|deposits|flaring|emissions|stove|stoves|oven|ovens|cooktop|range|grill|heater|heaters|heating|furnace|boiler|appliance|appliances|fitter|fitters|works|holder|exchange|meter|meters|utility|bill|bills|supply|network|distribution|to heat|for heating)\b/i,
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

/** `natural gas prices` is not `natural petrol prices`. */
const NOT_FUEL_BEFORE =
  /\b(?:natural|propane|butane|liquefied|liquified|lp|lpg|cng|lng|shale|coal|landfill|town|producer)\s+$/i;

/** Kinds of email mailbox, as Exchange and webmail name them. They count only right before one. */
const MAIL_KIND = [
  'shared', 'groups?', 'teams?', 'rooms?', 'resource', 'equipment', 'archived?', 'archiving',
  'primary', 'linked', 'inactive', 'remote', 'cloud', 'hosted', 'virtual', 'online',
  'on-?prem(?:ises)?', 'site', 'folders?', 'discovery', 'arbitration', 'support',
  String.raw`help[\s-]?desk`, 'source', 'target', 'destination', 'voice', 'pop', 'generic',
  'functional',
].join('|');

/** The verbs of the Exchange cmdlets, as in `Get-Mailbox`. */
const MAIL_CMDLET = [
  'get', 'set', 'new', 'remove', 'enable', 'disable', 'search', 'export', 'import', 'add', 'move',
  'restore', 'test', 'update', 'connect', 'suspend', 'resume',
].join('|');

/** What an email mailbox has that a letterbox does not, right after one. */
const MAIL_PART = [
  String.raw`size\s+limits?`, 'limits?', 'space', 'access', 'rights', String.raw`move\s+requests?`,
  'audit(?:s|ing|ed)?', 'exports?', 'imports?', 'providers?', 'folders?', 'properties', 'items?',
  'usage', 'statistics', 'retention', 'archives?', 'archiving', 'search(?:es)?', 'clean-?up',
].join('|');

/** Words that put a mailbox in email, voicemail or an account from anywhere in its sentence. */
const MAIL_CONTEXT = [
  'e-?mails?', 'e-?mail(?:ed|ing)', 'inbox(?:es)?', 'outbox', 'webmail', String.raw`voice[\s-]?mails?`,
  'outlook', 'exchange', 'gmail', 'hotmail', 'yahoo', 'icloud', 'aol', String.raw`proton\s?mail`,
  'thunderbird', String.raw`(?:microsoft|office)\s+365`, '[mo]365', 'imap', String.raw`pop\s?3`,
  'smtp', 'mapi', 'activesync', 'quotas?', 'storage', 'exceed(?:s|ed|ing)?',
  String.raw`(?:size|storage|send(?:ing)?|receiv(?:e|ing))\s+limits?`,
  String.raw`\d+(?:[.,]\d+)?\s?(?:[kmgt]b|(?:kilo|mega|giga|tera)bytes?)`,
  'servers?', 'databases?', String.raw`(?<!\b(?:on|into)\s+)accounts?`, 'users?',
  'admin(?:istrator)?s?', 'passwords?', 'passcodes?', 'logins?', String.raw`log(?:ged|ging)?[\s-]?(?:in|on)`,
  String.raw`sign(?:ed|ing)?[\s-]?in`, 'sign-on', 'settings', 'permissions?', String.raw`full\s+access`,
  'delegat(?:e|es|ed|ing|ion)', 'migrat(?:e|es|ed|ing|ions?)', 'sync(?:s|ed|ing)?',
  'synchroni[sz](?:e|es|ed|ing|ation)', 'domains?', 'organi[sz]ations?', 'messages?', 'attachments?',
  'spam', 'phishing', 'undeliverable', String.raw`(?:automatic|auto)[\s-]?repl(?:y|ies)`,
  String.raw`out[\s-]of[\s-](?:the[\s-])?office`, String.raw`mail[\s-](?:clients?|apps?|flow|enabled)`,
  'phones?', String.raw`dial(?:s|ed|ing|led|ling)?\s+(?:[*#+]|\d+|in(?:to)?\b)`,
  String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`,
  // Another mailbox in the sentence that is plainly the email kind.
  String.raw`(?:${MAIL_CMDLET})-mailbox\w*`, String.raw`(?:${MAIL_KIND})[\s-]+mailbox(?:es)?`,
  String.raw`mailbox(?:es)?[\s-]+(?:${MAIL_PART})`,
].join('|');

const MAIL_STATE_ADVERB =
  String.raw`(?:\s+(?:almost|nearly|completely|currently|now|already|too|over|\d+\s?%))*`;

/**
 * A bounce or quota notice: `mailbox full`, `is almost full`, `unavailable`. A letterbox
 * that is full is full of something, so a full one counts from anywhere after it.
 */
const MAIL_STATE =
  String.raw`^(?:['’]s|\s+(?:is|was|are|were|gets|got|getting|has\s+been|has\s+become))?` +
  String.raw`${MAIL_STATE_ADVERB}\s+(?:full\b(?!\s+of\b)|filling\s+up\b(?!\s+with\b)` +
  String.raw`|unavailable|not\s+found|does\s+not\s+exist|doesn['’]t\s+exist|disabled|deactivated` +
  String.raw`|suspended)\b` +
  String.raw`|^${IN_SENTENCE}*?\b(?:is|are|was|were)${MAIL_STATE_ADVERB}\s+full\b(?!\s+of\b)`;

/**
 * Refuses a mailbox that holds email or voicemail, which is no letterbox or postbox in any
 * dialect. The shared rows and every dialect's `mailbox` rows carry it.
 */
export const NOT_EMAIL_MAILBOX: Guard = {
  forbidBefore: new RegExp(
    String.raw`\b(?:${MAIL_KIND})(?:['’]s)?[\s-]+$|\b(?:${MAIL_CMDLET})-$` +
      String.raw`|\b(?:${MAIL_CONTEXT})\b${IN_SENTENCE}*$`,
    'i',
  ),
  forbidAfter: new RegExp(
    String.raw`^(?:['’]s)?[\s-]+(?:${MAIL_PART})\b|${MAIL_STATE}` +
      String.raw`|^${IN_SENTENCE}*?\b(?:${MAIL_CONTEXT})\b`,
    'i',
  ),
};

/**
 * A mailbox alone in its sentence is a label, and in webmail that is the email one. So the
 * shared row needs another word beside it, on one side or the other.
 */
const MAILBOX_GATES: Guard[] = [
  { ...NOT_EMAIL_MAILBOX, requireBefore: new RegExp(`[a-z0-9]${IN_SENTENCE}*$`, 'i') },
  { ...NOT_EMAIL_MAILBOX, requireAfter: new RegExp(`^${IN_SENTENCE}*?[a-z0-9]`, 'i') },
];

export function baseVocabulary(): LexEntry[] {
  return [
    ...set('vocabulary.motoring', 'moderate', MOTORING).map((entry) =>
      // Every `gas ...` phrase needs the same guard the bare word has.
      entry.from.startsWith('gas ') ? { ...entry, forbidBefore: NOT_FUEL_BEFORE } : entry,
    ),
    ...set('vocabulary.food', 'moderate', FOOD),
    ...set('vocabulary.household', 'moderate', HOUSEHOLD),
    ...set('vocabulary.clothing', 'moderate', CLOTHING),
    ...set('vocabulary.everyday', 'moderate', EVERYDAY).flatMap((entry) =>
      entry.from.startsWith('mailbox') ? MAILBOX_GATES.map((gate) => ({ ...entry, ...gate })) : [entry],
    ),
    ...set('vocabulary.education', 'risky', EDUCATION).map((entry) =>
      // The replacement ends in `fees`, so a fee already after the word would be said twice.
      entry.from === 'tuition' ? { ...entry, forbidAfter: /^\s+fees?\b/i } : entry,
    ),
    ...GRADES,
    ...CONTEXTUAL.map((entry) => ({ ...entry, priority: 20 })),
  ];
}
