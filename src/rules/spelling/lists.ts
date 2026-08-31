/**
 * Word data for the spelling rules.
 *
 * The recurring trap here is derivatives: `humour` but `humorous`, `vigour` but
 * `vigorous`, `labour` but `laborious`, `vapour` but `vaporise`, `glamour` but
 * `glamorous`. Those forms are identical in every dialect, so every list below is
 * explicit rather than generated from a stem.
 */

export type Pair = [american: string, target: string];

/**
 * Suffixes that swallow a stem's final `e`: `catalogue` + `ed` is `catalogued`, not
 * `catalogueed`. Compounding suffixes such as `fibre` + `optic` keep it.
 */
const E_DROPPING = new Set([
  'ed', 'ing', 'er', 'ers', 'est', 'able', 'ability', 'ably', 'ist', 'ists',
  'ation', 'ations', 'ous', 'ish',
]);

function join(stem: string, suffix: string): string {
  return stem.endsWith('e') && E_DROPPING.has(suffix) ? stem.slice(0, -1) + suffix : stem + suffix;
}

/** `color, colors, colored` -> `colour, colours, coloured`. */
function forms(from: string, to: string, suffixes: string[]): Pair[] {
  return [[from, to], ...suffixes.map((s): Pair => [from + s, join(to, s)])];
}

const VERB = ['s', 'ed', 'ing'];

// -or -> -our. Only the words that take the u, and only in the forms that keep it.
export const OUR: Pair[] = [
  ...forms('color', 'colour', [
    ...VERB, 'ful', 'fully', 'fulness', 'less', 'ant', 'ants', 'ation', 'ations',
    'way', 'ways', 'blind', 'blindness', 'fast', 'able',
  ]),
  ...forms('colorize', 'colourise', ['', 's', 'd']),
  ['colorizing', 'colourising'],
  ['colorization', 'colourisation'],
  ...forms('discolor', 'discolour', VERB),
  ['discoloration', 'discolouration'],
  ['discolorations', 'discolourations'],
  ...forms('recolor', 'recolour', VERB),
  ...forms('multicolor', 'multicolour', ['', 'ed']),
  ...forms('watercolor', 'watercolour', ['', 's']),
  ...forms('honor', 'honour', [...VERB, 'able', 'ably', 'ee', 'ees']),
  ...forms('dishonor', 'dishonour', [...VERB, 'able', 'ably']),
  ...forms('labor', 'labour', [...VERB, 'er', 'ers']),
  ...forms('belabor', 'belabour', VERB),
  ...forms('favor', 'favour', [...VERB, 'ite', 'ites', 'able', 'ably', 'ability', 'itism']),
  ...forms('unfavor', 'unfavour', ['able', 'ably']),
  ...forms('disfavor', 'disfavour', VERB),
  ...forms('flavor', 'flavour', [...VERB, 'ings', 'ful', 'less', 'some']),
  ...forms('humor', 'humour', [...VERB, 'less', 'lessly']),
  ...forms('neighbor', 'neighbour', [...VERB, 'hood', 'hoods', 'ly', 'liness']),
  ...forms('rumor', 'rumour', VERB),
  ...forms('savor', 'savour', VERB),
  ['savory', 'savoury'],
  ['savories', 'savouries'],
  ...forms('armor', 'armour', [...VERB, 'er', 'ers', 'y', 'ies']),
  ...forms('behavior', 'behaviour', ['', 's', 'al', 'ally', 'ism', 'ist', 'ists']),
  ...forms('misbehavior', 'misbehaviour', ['', 's']),
  ...forms('endeavor', 'endeavour', VERB),
  ...forms('harbor', 'harbour', VERB),
  ...forms('clamor', 'clamour', VERB),
  ...forms('parlor', 'parlour', ['', 's']),
  ...forms('odor', 'odour', ['', 's', 'less']),
  ...forms('tumor', 'tumour', ['', 's']),
  ...forms('savior', 'saviour', ['', 's']),
  ...forms('demeanor', 'demeanour', ['', 's']),
  ...forms('misdemeanor', 'misdemeanour', ['', 's']),
  ...forms('vapor', 'vapour', ['', 's']),
  ['enamored', 'enamoured'],
  ['unenamored', 'unenamoured'],
  ['valor', 'valour'],
  ['vigor', 'vigour'],
  ['splendor', 'splendour'],
  ['candor', 'candour'],
  ['ardor', 'ardour'],
  ['fervor', 'fervour'],
  ['rancor', 'rancour'],
  ['succor', 'succour'],
  ['glamor', 'glamour'],
];

// -er -> -re.
export const RE: Pair[] = [
  ['center', 'centre'],
  ['centers', 'centres'],
  ['centered', 'centred'],
  ['centering', 'centring'],
  ['centerpiece', 'centrepiece'],
  ['centerpieces', 'centrepieces'],
  ['centerline', 'centreline'],
  ['centerfold', 'centrefold'],
  ['epicenter', 'epicentre'],
  ['epicenters', 'epicentres'],
  ...forms('fiber', 'fibre', ['', 's', 'glass', 'board', 'optic', 'optics']),
  ...forms('theater', 'theatre', ['', 's']),
  ...forms('amphitheater', 'amphitheatre', ['', 's']),
  ...forms('maneuver', 'manoeuvre', [...VERB, 'able', 'ability']),
  ...forms('caliber', 'calibre', ['', 's']),
  ...forms('saber', 'sabre', ['', 's']),
  ...forms('specter', 'spectre', ['', 's']),
  ...forms('scepter', 'sceptre', ['', 's']),
  ['luster', 'lustre'],
  ['lackluster', 'lacklustre'],
  ['somber', 'sombre'],
  ['somberly', 'sombrely'],
  ['meager', 'meagre'],
  ['meagerly', 'meagrely'],
  ['ocher', 'ochre'],
  ['goiter', 'goitre'],
  ['miter', 'mitre'],
  ['niter', 'nitre'],
  ['philter', 'philtre'],
  ['titer', 'titre'],
  ['reconnoiter', 'reconnoitre'],
  ['sepulcher', 'sepulchre'],
  ['accouter', 'accoutre'],
  ['accouterments', 'accoutrements'],
];

/** SI units only. A `parking meter` and a `thermometer` are spelt that way everywhere. */
export const METRIC_RE: Pair[] = [
  ...['kilo', 'centi', 'milli', 'nano', 'pico', 'femto', 'deci', 'deca', 'deka', 'hecto']
    .flatMap((prefix): Pair[] => [
      [`${prefix}meter`, `${prefix}metre`],
      [`${prefix}meters`, `${prefix}metres`],
      [`${prefix}liter`, `${prefix}litre`],
      [`${prefix}liters`, `${prefix}litres`],
    ]),
  ['microliter', 'microlitre'],
  ['microliters', 'microlitres'],
  ['hectoliter', 'hectolitre'],
  ['liter', 'litre'],
  ['liters', 'litres'],
];

// -ense -> -ence.
export const ENCE: Pair[] = [
  ['defense', 'defence'],
  ['defenses', 'defences'],
  ['defenseless', 'defenceless'],
  ['defenselessly', 'defencelessly'],
  ['offense', 'offence'],
  ['offenses', 'offences'],
  ['pretense', 'pretence'],
  ['pretenses', 'pretences'],
];

// -og -> -ogue.
export const OGUE: Pair[] = [
  ...forms('catalog', 'catalogue', ['', 's', 'ed', 'ing', 'er', 'ers']),
  ...forms('monolog', 'monologue', ['', 's']),
  ...forms('epilog', 'epilogue', ['', 's']),
  ...forms('travelog', 'travelogue', ['', 's']),
  ...forms('homolog', 'homologue', ['', 's']),
  ...forms('demagog', 'demagogue', ['', 's']),
  ...forms('pedagog', 'pedagogue', ['', 's']),
  ...forms('synagog', 'synagogue', ['', 's']),
  ['decalog', 'decalogue'],
];

/** `dialog` and `analog` are also API and hardware names, so they get their own tier. */
export const OGUE_TECHNICAL: Pair[] = [
  ['dialog', 'dialogue'],
  ['dialogs', 'dialogues'],
  ['analog', 'analogue'],
  ['analogs', 'analogues'],
  ['prolog', 'prologue'],
];

/**
 * Verbs that double a final `l` before a vowel suffix outside America.
 * Excludes verbs stressed on the last syllable (rebel, compel, patrol), which
 * already double in American English.
 */
export const DOUBLE_L_VERBS = [
  'cancel', 'travel', 'label', 'model', 'fuel', 'refuel', 'marvel', 'signal', 'total',
  'dial', 'counsel', 'level', 'libel', 'rival', 'shovel', 'shrivel', 'spiral', 'unravel',
  'equal', 'funnel', 'channel', 'chisel', 'quarrel', 'tunnel', 'jewel', 'panel', 'parcel',
  'pedal', 'pencil', 'revel', 'snorkel', 'swivel', 'tassel', 'tinsel', 'trowel', 'victual',
  'initial', 'relabel', 'remodel', 'grovel', 'gambol', 'medal', 'pummel', 'ravel', 'kennel',
  'barrel', 'bevel', 'cavil', 'dishevel', 'drivel', 'duel', 'enamel', 'gravel', 'imperil',
  'marshal', 'nickel', 'stencil', 'trammel', 'vitriol', 'weasel', 'yodel', 'towel',
];

/** Non-`l` verbs that gain a doubled consonant. */
export const DOUBLE_OTHER: Pair[] = [
  ['worshiped', 'worshipped'],
  ['worshiping', 'worshipping'],
  ['worshiper', 'worshipper'],
  ['worshipers', 'worshippers'],
  ['kidnaped', 'kidnapped'],
  ['kidnaping', 'kidnapping'],
  ['kidnaper', 'kidnapper'],
];

/** The other direction: American doubles the `l` where the rest of us do not. */
export const SINGLE_L: Pair[] = [
  ['enroll', 'enrol'],
  ['enrolls', 'enrols'],
  ['enrollment', 'enrolment'],
  ['enrollments', 'enrolments'],
  ['fulfill', 'fulfil'],
  ['fulfills', 'fulfils'],
  ['fulfillment', 'fulfilment'],
  ['fulfillments', 'fulfilments'],
  ['instill', 'instil'],
  ['instills', 'instils'],
  ['instillment', 'instilment'],
  ['distill', 'distil'],
  ['distills', 'distils'],
  ['appall', 'appal'],
  ['appalls', 'appals'],
  ['installment', 'instalment'],
  ['installments', 'instalments'],
  ['skillful', 'skilful'],
  ['skillfully', 'skilfully'],
  ['willful', 'wilful'],
  ['willfully', 'wilfully'],
  ['thralldom', 'thraldom'],
  ['cancelation', 'cancellation'],
  ['cancelations', 'cancellations'],
];

/** ae / oe digraphs, mostly medical and classical. */
export const DIGRAPH: Pair[] = [
  ...forms('esthetic', 'aesthetic', ['', 's', 'ally']),
  ['unesthetic', 'unaesthetic'],
  ['anesthesia', 'anaesthesia'],
  ...forms('anesthetic', 'anaesthetic', ['', 's']),
  ...forms('anesthetist', 'anaesthetist', ['', 's']),
  ['anesthetize', 'anaesthetise'],
  ['anesthetized', 'anaesthetised'],
  ...forms('archeolog', 'archaeolog', ['y', 'ical', 'ically', 'ist', 'ists']),
  ...forms('gynecolog', 'gynaecolog', ['y', 'ical', 'ist', 'ists']),
  ...forms('pediatric', 'paediatric', ['', 's']),
  ...forms('pediatrician', 'paediatrician', ['', 's']),
  ...forms('orthopedic', 'orthopaedic', ['', 's']),
  ['pedophile', 'paedophile'],
  ['pedophiles', 'paedophiles'],
  ['pedophilia', 'paedophilia'],
  ['hemoglobin', 'haemoglobin'],
  ...forms('hemorrhage', 'haemorrhage', ['', 's', 'd']),
  ['hemorrhaging', 'haemorrhaging'],
  ['hemorrhoid', 'haemorrhoid'],
  ['hemorrhoids', 'haemorrhoids'],
  ...forms('hematolog', 'haematolog', ['y', 'ical', 'ist', 'ists']),
  ['hematoma', 'haematoma'],
  ['hemophilia', 'haemophilia'],
  ['hemophiliac', 'haemophiliac'],
  ['leukemia', 'leukaemia'],
  ['leukemic', 'leukaemic'],
  ['anemia', 'anaemia'],
  ['anemic', 'anaemic'],
  ['ischemia', 'ischaemia'],
  ['ischemic', 'ischaemic'],
  ['septicemia', 'septicaemia'],
  ['toxemia', 'toxaemia'],
  ['diarrhea', 'diarrhoea'],
  ['gonorrhea', 'gonorrhoea'],
  ['edema', 'oedema'],
  ['esophagus', 'oesophagus'],
  ['esophageal', 'oesophageal'],
  ['estrogen', 'oestrogen'],
  ['estrus', 'oestrus'],
  ['feces', 'faeces'],
  ['fecal', 'faecal'],
  ['celiac', 'coeliac'],
  ['cesium', 'caesium'],
  ['cesarean', 'caesarean'],
  ['cesarian', 'caesarean'],
  ['paleontology', 'palaeontology'],
  ['paleolithic', 'palaeolithic'],
  ['encyclopedia', 'encyclopaedia'],
  ['encyclopedias', 'encyclopaedias'],
  ['encyclopedic', 'encyclopaedic'],
  ['homeopathy', 'homoeopathy'],
];

/** One-off spellings with no shared pattern. */
export const IRREGULAR: Pair[] = [
  ['aluminum', 'aluminium'],
  ['math', 'maths'],
  ['airplane', 'aeroplane'],
  ['airplanes', 'aeroplanes'],
  ['pajamas', 'pyjamas'],
  ['mustache', 'moustache'],
  ['mustaches', 'moustaches'],
  ['omelet', 'omelette'],
  ['omelets', 'omelettes'],
  ['yogurt', 'yoghurt'],
  ['yogurts', 'yoghurts'],
  ['donut', 'doughnut'],
  ['donuts', 'doughnuts'],
  ['licorice', 'liquorice'],
  ['cozy', 'cosy'],
  ['cozier', 'cosier'],
  ['coziest', 'cosiest'],
  ['cozily', 'cosily'],
  ['coziness', 'cosiness'],
  ['skeptic', 'sceptic'],
  ['skeptics', 'sceptics'],
  ['skeptical', 'sceptical'],
  ['skeptically', 'sceptically'],
  ['skepticism', 'scepticism'],
  ...forms('plow', 'plough', [...VERB, 'man', 'share']),
  ['snowplow', 'snowplough'],
  ['snowplows', 'snowploughs'],
  ...forms('mold', 'mould', [...VERB, 'y', 'ier', 'iest', 'ings', 'er', 'ers']),
  ...forms('smolder', 'smoulder', VERB),
  ...forms('molt', 'moult', VERB),
  ['gray', 'grey'],
  ['grays', 'greys'],
  ['grayed', 'greyed'],
  ['grayer', 'greyer'],
  ['grayest', 'greyest'],
  ['grayish', 'greyish'],
  ['grayscale', 'greyscale'],
  ['aging', 'ageing'],
  ['acknowledgment', 'acknowledgement'],
  ['acknowledgments', 'acknowledgements'],
  ['abridgment', 'abridgement'],
  ['normalcy', 'normality'],
  ['specialty', 'speciality'],
  ['specialties', 'specialities'],
  ['tidbit', 'titbit'],
  ['tidbits', 'titbits'],
  ['carburetor', 'carburettor'],
  ['carburetors', 'carburettors'],
  ['jewelry', 'jewellery'],
  ['woolen', 'woollen'],
  ['woolens', 'woollens'],
  ['toward', 'towards'],
  ['afterward', 'afterwards'],
  ['counterclockwise', 'anticlockwise'],
  // The only two `-ed` past forms that are American rather than merely one of two
  // native options: `knelt` and `leapt` are all but universal outside America.
  ['kneeled', 'knelt'],
  ['leaped', 'leapt'],
];

/** Correct outside America, but common enough as jargon that they need opting out of. */
export const IRREGULAR_TECHNICAL: Pair[] = [
  ['artifact', 'artefact'],
  ['artifacts', 'artefacts'],
  ['fetus', 'foetus'],
  ['fetuses', 'foetuses'],
  ['fetal', 'foetal'],
];
