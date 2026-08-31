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

/**
 * Guards for words that also appear inside a phrase the rest of the world already says.
 * `candy floss` is not American, so `candy` must not fire inside it.
 */
const GATES: Record<string, Pick<LexEntry, 'forbidAfter' | 'forbidBefore'>> = {
  candy: { forbidAfter: /^\s+floss\b/i },
  candies: { forbidAfter: /^\s+floss\b/i },
};

function rows(id: Dialect, list: Row[], confidence: Confidence = 'moderate'): LexEntry[] {
  return list.map(([from, to]) => ({
    from,
    to,
    ruleId: `dialect.${id}`,
    category: 'vocabulary' as const,
    confidence,
    priority: 30,
    ...GATES[from],
  }));
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
  ['pants', 'trousers'],
  ['soccer', 'football'],
  ['truck', 'lorry'],
  ['trucks', 'lorries'],
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
  ...GB.filter(([from]) => from !== '911' && from !== 'truck' && from !== 'trucks'),
  ['911', '10111'],
  ['traffic light', 'robot'],
  ['traffic lights', 'robots'],
  ['pickup truck', 'bakkie'],
  ['grocery store', 'cafe'],
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
  'spelling.contextual.irregular-past',
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
