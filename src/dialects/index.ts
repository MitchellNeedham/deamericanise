import type { Confidence, Dialect, LexEntry } from '../types.js';

export interface DialectPack {
  id: Dialect;
  label: string;
  /** Overrides the shared vocabulary; these entries outrank it on the same span. */
  vocabulary: LexEntry[];
  /** Rule ids switched off here. A trailing `.*` matches a prefix. */
  disable: string[];
  /** Source words this dialect spells the American way anyway. */
  keep: string[];
  /** Units this dialect still uses in everyday writing, left unconverted. */
  unitsKeep: string[];
}

type Row = [from: string, to: string];

type Guard = Pick<LexEntry, 'requireBefore' | 'requireAfter' | 'forbidBefore' | 'forbidAfter'>;

const anyOf = (words: string[]): string => words.join('|');

/** One character that does not end the sentence. A blank line ends one too. */
const IN_SENTENCE = String.raw`(?:(?![!?](?:\s|$)|(?<!\b(?:e\.g|i\.e))\.(?:\s|$)|\n[ \t]*\n)[\s\S])`;

/** Words that put a cookie on the web from anywhere in its sentence. */
const WEB_CONTEXT = anyOf([
  'browsers?', 'browsing', 'browse', 'web', 'websites?', 'webpages?', 'sites?', 'internet', 'online',
  'privacy', 'consent', 'gdpr', 'ccpa', 'tracking', 'trackers?', 'analytics', 'advertising', 'ads',
  'devices?', 'computers?', 'servers?', 'https?', 'domains?', 'log ?in', 'logged', 'javascript',
  'data', 'services', 'providers?', 'permission', 'traffic', 'visits?', 'visitors?', 'users?',
  '(?:first|third)[- ]party',
  String.raw`[\w-]+\.(?:com|org|net|gov|edu|io|uk|au|nz|ie|za|ca)`,
]);

/**
 * Kinds of web cookie, as consent banners name them. Most have an everyday sense too, so
 * they count only right before the cookie.
 */
const WEB_KIND = anyOf([
  'httponly', 'secure', 'session', 'persistent', '(?:1st|3rd)[- ]party', 'cross[- ]site',
  'same[- ]?site', 'flash', 'zombie', 'analytical', 'performance', 'functional', 'functionality',
  'marketing', 'targeting', 'necessary', '(?:non-?)?essential', 'optional', 'additional',
  'preferences?', 'statistics?', 'statistical', 'social media', 'authentication', 'security',
  'unclassified',
]);

/** What a banner asks the reader to do with cookies. */
const WEB_VERB = anyOf([
  'accept(?:s|ed|ing)?', 'reject(?:s|ed|ing)?', 'allow(?:s|ed|ing)?', 'block(?:s|ed|ing)?',
  'enabl(?:e|es|ed|ing)', 'disabl(?:e|es|ed|ing)', 'declin(?:e|es|ed|ing)', 'refus(?:e|es|ed|ing)',
  'manag(?:e|es|ed|ing)', 'delet(?:e|es|ed|ing)', 'clear(?:s|ed|ing)?', 'customi[sz](?:e|es|ed|ing)',
  'us(?:e|es|ed|ing)(?:\\s+of)?', 'agree(?:s|d|ing)?\\s+to',
]);

/** `the` is left out: `use the cookies as a base` is a recipe. */
const WEB_VERB_OBJECT = anyOf([
  'all', 'only', 'our', 'your', 'any', 'some', 'additional', 'selected', 'optional',
]);

/** What a web cookie has that a biscuit does not, right after the cookie. */
const WEB_PART = anyOf([
  'banners?', 'polic(?:y|ies)', 'notices?', 'settings?', 'preferences?', 'choices', 'controls',
  'files?', 'ids?', 'identifiers?', 'headers?', 'names?', 'values?', 'storage', 'declaration',
  'statement', 'wall', 'pop-?ups?', 'prompts?', 'messages?', 'manager', 'management', 'laws?',
  'directive', 'sync(?:ing)?', 'matching', 'list', 'categor(?:y|ies)', 'duration', 'expiry',
  'expiration', 'lifetime', 'opt-?outs?', 'usage', 'use', 'technolog(?:y|ies)', 'audit',
  'scan(?:ner)?', 'strings?', 'parameters?', 'attributes?', 'flags?', 'path',
]);

const COOKIE_FORBID: Guard = {
  forbidBefore: new RegExp(
    String.raw`(?:\b(?:${WEB_VERB})(?:\s+(?:${WEB_VERB_OBJECT}))*|\b(?:${WEB_KIND}|fortune|girl scout))[\s-]+$` +
      String.raw`|\b(?:${WEB_CONTEXT})\b${IN_SENTENCE}*$`,
    'i',
  ),
  // A hyphenated `cookie-cutter` is the figurative one, which keeps its cookie everywhere.
  forbidAfter: new RegExp(
    String.raw`^(?:['’]s)?[\s-]+(?:${WEB_PART})\b|^-cutter\b|^\s+monster\b` +
      String.raw`|^${IN_SENTENCE}*?\b(?:${WEB_CONTEXT})\b`,
    'i',
  ),
};

/**
 * A cookie that is the only word in its sentence is a heading, button or link with nothing
 * to judge it by, and on most pages that is the link to the cookie policy. So a cookie
 * changes only with another word beside it in the sentence, on one side or the other.
 */
const COOKIE: Guard[] = [
  { ...COOKIE_FORBID, requireBefore: new RegExp(`[a-z0-9]${IN_SENTENCE}*$`, 'i') },
  { ...COOKIE_FORBID, requireAfter: new RegExp(`^${IN_SENTENCE}*?[a-z0-9]`, 'i') },
];

/** Trucks Britain calls trucks too. */
const TRUCK: Guard[] = [
  { forbidBefore: /\b(?:pick-?up|dump|fork-?lift|food|monster|tow|ice[\s-]cream)[\s-]+$/i },
];

const PANTS_IDIOM =
  /(?:\bsmart(?:y|ie)[\s-]+|\bfancy-|\bseat[\s-]+of[\s-]+(?:the|your|my|his|her|its|our|their|one['’]s)[\s-]+)$/i;

/** `scared the pants off me` needs both sides, so each guard checks one and either may pass. */
const PANTS: Guard[] = [
  { forbidBefore: new RegExp(`${PANTS_IDIOM.source}|\\bthe\\s+$`, 'i') },
  { forbidBefore: PANTS_IDIOM, forbidAfter: /^\s+off\b/i },
];

/** Capitalised words that start a sentence in front of a highway rather than name it. */
const NOT_A_NAME = anyOf([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'Each', 'Every', 'Any', 'No', 'Our', 'Your',
  'Their', 'His', 'Her', 'Its', 'My', 'On', 'In', 'Along', 'Off', 'Onto', 'Into', 'From', 'To',
  'Near', 'Across', 'Down', 'Up', 'Over', 'Under', 'Past', 'Via', 'By', 'At', 'Take', 'Avoid',
  'Use', 'Leave', 'Join', 'Cross', 'And', 'But', 'Or', 'So', 'Then', 'When', 'While', 'If', 'As',
]);

const HIGHWAY_AGENCY = anyOf([
  'Administration', 'Traffic', 'Code', 'Department', 'Authority', 'Agency', 'Commission', 'Act',
  'System', 'Trust',
]);

/**
 * A named or numbered highway is a name, and so is an agency named after one. Case-sensitive,
 * since the capital is what marks the name.
 */
const HIGHWAY: Guard[] = [
  {
    forbidBefore: new RegExp(
      String.raw`\b[Ww]ay\s+or\s+the\s+$|\b(?!(?:${NOT_A_NAME})\s+$)[A-Z][\w.'’-]*\s+$`,
    ),
    forbidAfter: new RegExp(
      String.raw`^\s+(?:[A-Z]{0,3}-?\d|(?:${HIGHWAY_AGENCY})\b|[Pp]atrol\b|[Rr]obbery\b)`,
    ),
  },
];

const APARTMENT: Guard[] = [{ forbidBefore: /\bserviced\s+$/i, forbidAfter: /^\s+complex(?:es)?\b/i }];

/**
 * A postbox is only the kind for posting letters. A mailbox at home is a letterbox, which
 * is what the shared vocabulary says when this refuses.
 */
const MAILBOX: Guard[] = [
  { requireBefore: /\b(?:public|blue|usps|collection|corner|nearest|nearby|any)\s+$/i },
];

/**
 * A university or science field trip is not a school trip, and a `school field trip` would
 * say school twice. The shared word stands for both.
 */
const FIELD_TRIP: Guard[] = [
  {
    forbidBefore:
      /\b(?:[a-z]+olog(?:y|ical)|university|college|undergraduate|graduate|postgraduate|research|science|scientific|geography|geographical|botany|botanical|marine|environmental|school|class)\s+$/i,
  },
];

/**
 * Guards for words that also appear inside a phrase the rest of the world already says.
 * `candy floss` is not American, so `candy` must not fire inside it. A row with several
 * guards fires when any one of them lets it through.
 */
const GATES: Record<string, Guard[]> = {
  candy: [{ forbidAfter: /^\s+floss\b/i }],
  candies: [{ forbidAfter: /^\s+floss\b/i }],
  cookie: COOKIE,
  cookies: COOKIE,
  truck: TRUCK,
  trucks: TRUCK,
  pants: PANTS,
  highway: HIGHWAY,
  highways: HIGHWAY,
  apartment: APARTMENT,
  apartments: APARTMENT,
  mailbox: MAILBOX,
  mailboxes: MAILBOX,
  'field trip': FIELD_TRIP,
  'field trips': FIELD_TRIP,
};

function rows(id: Dialect, list: Row[], confidence: Confidence = 'moderate'): LexEntry[] {
  return list.flatMap(([from, to]) =>
    (GATES[from] ?? [{}]).map((guard) => ({
      from,
      to,
      ruleId: `dialect.${id}`,
      category: 'vocabulary' as const,
      confidence,
      priority: 30,
      ...guard,
    })),
  );
}

const AU: Row[] = [
  ['sidewalk', 'footpath'],
  ['sidewalks', 'footpaths'],
  ['candy', 'lollies'],
  ['candies', 'lollies'],
  ['candy bar', 'chocolate bar'],
  ['cookie', 'biscuit'],
  ['cookies', 'biscuits'],
  ['potato chips', 'chips'],
  ['potato chip', 'chip'],
  ['shrimp', 'prawn'],
  ['shrimps', 'prawns'],
  ['popsicle', 'icy pole'],
  ['popsicles', 'icy poles'],
  ['cotton candy', 'fairy floss'],
  ['sneakers', 'runners'],
  ['comforter', 'doona'],
  ['turtleneck', 'skivvy'],
  ['turtlenecks', 'skivvies'],
  ['undershirt', 'singlet'],
  ['undershirts', 'singlets'],
  ['thrift store', 'op shop'],
  ['thrift stores', 'op shops'],
  ['band-aid', 'bandaid'],
  ['band-aids', 'bandaids'],
  ['heavy cream', 'thickened cream'],
  ['liquor store', 'bottle shop'],
  ['liquor stores', 'bottle shops'],
  ['ketchup', 'tomato sauce'],
  ['bell pepper', 'capsicum'],
  ['bell peppers', 'capsicums'],
  ['flip flops', 'thongs'],
  ['cooler', 'esky'],
  ['pickup truck', 'ute'],
  ['downtown', 'the CBD'],
  ['trailer', 'caravan'],
  ['rain boots', 'gumboots'],
  ['galoshes', 'gumboots'],
  ['911', '000'],
  ['grocery store', 'supermarket'],
];

const GB: Row[] = [
  ['sidewalk', 'pavement'],
  ['sidewalks', 'pavements'],
  ['candy', 'sweets'],
  ['candies', 'sweets'],
  ['candy bar', 'chocolate bar'],
  ['cookie', 'biscuit'],
  ['cookies', 'biscuits'],
  ['potato chips', 'crisps'],
  ['potato chip', 'crisp'],
  ['apartment', 'flat'],
  ['apartments', 'flats'],
  ['apartment building', 'block of flats'],
  ['apartment buildings', 'blocks of flats'],
  ['pants', 'trousers'],
  ['soccer', 'football'],
  ['truck', 'lorry'],
  ['trucks', 'lorries'],
  ['fire truck', 'fire engine'],
  ['fire trucks', 'fire engines'],
  ['firetruck', 'fire engine'],
  ['firetrucks', 'fire engines'],
  ['freeway', 'motorway'],
  ['freeways', 'motorways'],
  ['highway', 'motorway'],
  ['highways', 'motorways'],
  ['eggplant', 'aubergine'],
  ['eggplants', 'aubergines'],
  ['zucchini', 'courgette'],
  ['zucchinis', 'courgettes'],
  ['shrimp', 'prawn'],
  ['shrimps', 'prawns'],
  ['popsicle', 'ice lolly'],
  ['popsicles', 'ice lollies'],
  ['cotton candy', 'candy floss'],
  ['sneakers', 'trainers'],
  ['comforter', 'duvet'],
  ['turtleneck', 'polo neck'],
  ['undershirt', 'vest'],
  ['thrift store', 'charity shop'],
  ['thrift stores', 'charity shops'],
  ['band-aid', 'plaster'],
  ['band-aids', 'plasters'],
  ['heavy cream', 'double cream'],
  ['liquor store', 'off-licence'],
  ['liquor stores', 'off-licences'],
  ['bell pepper', 'pepper'],
  ['bell peppers', 'peppers'],
  ['postie', 'postman'],
  ['posties', 'postmen'],
  ['mailbox', 'postbox'],
  ['mailboxes', 'postboxes'],
  ['field trip', 'school trip'],
  ['field trips', 'school trips'],
  ['sulfur', 'sulphur'],
  ['sulfuric', 'sulphuric'],
  ['sulfate', 'sulphate'],
  ['sulfide', 'sulphide'],
  ['tv program', 'TV programme'],
  ['television program', 'television programme'],
  ['radio program', 'radio programme'],
  ['911', '999'],
];

const NZ: Row[] = [
  ['sidewalk', 'footpath'],
  ['sidewalks', 'footpaths'],
  ['candy', 'lollies'],
  ['candies', 'lollies'],
  ['cookie', 'biscuit'],
  ['cookies', 'biscuits'],
  ['potato chips', 'chips'],
  ['apartment', 'flat'],
  ['apartments', 'flats'],
  ['soccer', 'football'],
  ['freeway', 'motorway'],
  ['highway', 'motorway'],
  ['zucchini', 'courgette'],
  ['zucchinis', 'courgettes'],
  ['shrimp', 'prawn'],
  ['popsicle', 'ice block'],
  ['popsicles', 'ice blocks'],
  ['cotton candy', 'candy floss'],
  ['comforter', 'duvet'],
  ['undershirt', 'singlet'],
  ['thrift store', 'op shop'],
  ['band-aid', 'plaster'],
  ['band-aids', 'plasters'],
  ['liquor store', 'bottle shop'],
  ['bell pepper', 'capsicum'],
  ['bell peppers', 'capsicums'],
  ['flip flops', 'jandals'],
  ['cooler', 'chilly bin'],
  ['pickup truck', 'ute'],
  ['911', '111'],
];

const IE: Row[] = [
  ...GB.filter(([from]) => from !== '911'),
  ['911', '112'],
];

const ZA: Row[] = [
  // South Africa says truck, fire truck included.
  ...GB.filter(([from]) => from !== '911' && !from.includes('truck')),
  ['911', '10111'],
  ['traffic light', 'robot'],
  ['traffic lights', 'robots'],
  ['pickup truck', 'bakkie'],
];

/**
 * Canadian English sits between the two: it keeps `-ize`, `color` is wrong but
 * `aluminum`, `math`, `tire`, `gas` and `curb` are all right, and most of the
 * vocabulary is American. Only the `-our`, `-re` and `-ce` spellings carry over.
 */
const CA_DISABLE = [
  'spelling.ise',
  'spelling.yse',
  'spelling.ogue-technical',
  'spelling.irregular-technical',
  'spelling.contextual.tyre',
  'spelling.contextual.kerb',
  'spelling.contextual.draught',
  'spelling.contextual.gotten',
  'vocabulary.*',
  'dialect.*',
  'misc.emergency',
];

const CA_KEEP = [
  'aluminum', 'math', 'artifact', 'artifacts', 'specialty', 'specialties',
  'gotten', 'toward', 'afterward',
];

export const DIALECTS: Record<Dialect, DialectPack> = {
  'en-AU': {
    id: 'en-AU',
    label: 'Australian English',
    vocabulary: rows('en-AU', AU),
    disable: [],
    keep: [],
    unitsKeep: [],
  },
  'en-GB': {
    id: 'en-GB',
    label: 'British English',
    vocabulary: rows('en-GB', GB),
    disable: [],
    keep: [],
    // Britain still signs its roads in miles and pours beer in pints.
    unitsKeep: ['mile', 'mph', 'pint', 'stone'],
  },
  'en-NZ': {
    id: 'en-NZ',
    label: 'New Zealand English',
    vocabulary: rows('en-NZ', NZ),
    disable: [],
    keep: [],
    unitsKeep: [],
  },
  'en-IE': {
    id: 'en-IE',
    label: 'Irish English',
    vocabulary: rows('en-IE', IE),
    disable: [],
    keep: [],
    unitsKeep: ['pint'],
  },
  'en-ZA': {
    id: 'en-ZA',
    label: 'South African English',
    vocabulary: rows('en-ZA', ZA),
    disable: [],
    keep: [],
    unitsKeep: [],
  },
  'en-CA': {
    id: 'en-CA',
    label: 'Canadian English',
    vocabulary: [],
    disable: CA_DISABLE,
    keep: CA_KEEP,
    unitsKeep: [],
  },
};

export function dialectPack(id: Dialect): DialectPack {
  const pack = DIALECTS[id];
  if (!pack) throw new Error(`Unknown dialect: ${id}. Expected one of ${Object.keys(DIALECTS).join(', ')}.`);
  return pack;
}
