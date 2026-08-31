import type { LexEntry } from '../../types.js';

/**
 * Words where American English collapsed a distinction the rest of us keep, so the
 * correct spelling depends on the sense: a `tyre` versus to `tire`, a `licence` versus
 * to `license`. Each entry is gated on its surroundings and tagged `risky`, because
 * a gate is a guess.
 *
 * Several senses of one word are expressed as several entries sharing a `from`; the
 * matcher takes the first whose gates pass.
 */

const ctx = (e: Omit<LexEntry, 'category' | 'confidence'>): LexEntry => ({
  ...e,
  category: 'spelling',
  confidence: 'risky',
});

const DETERMINER = String.raw`(?:a|an|the|this|that|your|my|his|her|its|their|our)`;

// Subjects and modals that make the following word a verb rather than a noun.
const VERB_LEAD = new RegExp(
  String.raw`\b(?:to|will|would|shall|should|can|could|must|may|might|let'?s|help|` +
    String.raw`don'?t|doesn'?t|didn'?t|cannot|not|never|we|they|i|you|he|she|who|and)\s+$`,
  'i',
);

export const CONTEXTUAL: LexEntry[] = [
  // ----- tire / tyre -----
  ...['tire', 'tires'].flatMap((from): LexEntry[] => {
    const to = from === 'tire' ? 'tyre' : 'tyres';
    const notAVerb = VERB_LEAD;
    return [
      ctx({
        from,
        to,
        ruleId: 'spelling.contextual.tyre',
        requireBefore: new RegExp(
          String.raw`\b(?:flat|spare|bald|worn|front|rear|winter|snow|summer|all-season|` +
            String.raw`radial|run-flat|bike|bicycle|car|truck|new|old|two|four|\d+|${DETERMINER})\s+$`,
          'i',
        ),
        forbidBefore: notAVerb,
      }),
      ctx({
        from,
        to,
        ruleId: 'spelling.contextual.tyre',
        requireAfter:
          /^[\s-]+(?:pressure|tread|iron|wall|walls|rotation|shop|blowout|marks?|tracks?|size|sizes|and wheel|change)\b/i,
        forbidBefore: notAVerb,
      }),
    ];
  }),
  ctx({ from: 'tire pressure', to: 'tyre pressure', ruleId: 'spelling.contextual.tyre' }),

  // ----- check / cheque -----
  ctx({
    from: 'check',
    to: 'cheque',
    ruleId: 'spelling.contextual.cheque',
    requireAfter: /^\s+(?:for\s+[$\d]|payable|in the amount|number\s+\d|book\b)/i,
  }),
  ctx({
    from: 'check',
    to: 'cheque',
    ruleId: 'spelling.contextual.cheque',
    requireBefore: new RegExp(
      String.raw`\b(?:cash(?:ed|ing|es)?|deposit(?:ed|ing|s)?|wrote|writes?|writing|mail(?:ed)?|` +
        String.raw`post(?:ed)?|sent|send|endorse[ds]?|bounced?|void(?:ed)?|by|personal|certified|` +
        String.raw`cashier'?s|blank|traveller'?s|traveler'?s|refund|rebate|stimulus|severance|paper)\s+` +
        String.raw`(?:${DETERMINER}\s+)?$`,
      'i',
    ),
  }),
  ctx({ from: 'checkbook', to: 'chequebook', ruleId: 'spelling.contextual.cheque' }),
  ctx({ from: 'checkbooks', to: 'chequebooks', ruleId: 'spelling.contextual.cheque' }),
  ctx({ from: 'checking account', to: 'cheque account', ruleId: 'spelling.contextual.cheque' }),
  ctx({ from: 'paycheck', to: 'pay cheque', ruleId: 'spelling.contextual.cheque' }),
  ctx({ from: 'paychecks', to: 'pay cheques', ruleId: 'spelling.contextual.cheque' }),

  // ----- practice / practise. The -ed and -ing forms take an s everywhere, so they are safe. -----
  {
    from: 'practiced',
    to: 'practised',
    ruleId: 'spelling.practise',
    category: 'spelling',
    confidence: 'safe',
  },
  {
    from: 'practicing',
    to: 'practising',
    ruleId: 'spelling.practise',
    category: 'spelling',
    confidence: 'safe',
  },
  ctx({
    from: 'practice',
    to: 'practise',
    ruleId: 'spelling.contextual.practise',
    requireBefore: VERB_LEAD,
  }),
  ctx({
    from: 'practices',
    to: 'practises',
    ruleId: 'spelling.contextual.practise',
    requireBefore: /\b(?:he|she|who|that|one|it)\s+$/i,
  }),

  // ----- license / licence. Only the noun takes a c; licensed/licensing/licensee never do. -----
  ctx({
    from: 'license',
    to: 'licence',
    ruleId: 'spelling.contextual.licence',
    requireBefore: new RegExp(
      String.raw`\b(?:driver'?s|drivers|driving|business|liquor|marriage|pilot'?s|fishing|hunting|` +
        String.raw`gun|firearms?|full|provisional|valid|expired|renew(?:ed|ing|al)?|` +
        String.raw`${DETERMINER})\s+$`,
      'i',
    ),
    forbidAfter: /^\s+(?:to\b|[A-Z])/,
  }),
  ctx({
    from: 'license',
    to: 'licence',
    ruleId: 'spelling.contextual.licence',
    requireAfter: /^\s+(?:plate|number|fee|holder|renewal|expires|expired)\b/i,
  }),
  ctx({
    from: 'licenses',
    to: 'licences',
    ruleId: 'spelling.contextual.licence',
    requireBefore: new RegExp(String.raw`\b(?:${DETERMINER}|driver'?s|\d+|several|many|all)\s+$`, 'i'),
  }),

  // ----- story / storey (a floor of a building) -----
  ...['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'multi', 'single']
    .flatMap((n): LexEntry[] => [
      ctx({ from: `${n} story`, to: `${n}-storey`, ruleId: 'spelling.contextual.storey' }),
      ctx({ from: `${n} storied`, to: `${n}-storeyed`, ruleId: 'spelling.contextual.storey' }),
    ]),
  ctx({
    from: 'story',
    to: 'storey',
    ruleId: 'spelling.contextual.storey',
    requireBefore: /\b(?:\d+|first|second|third|fourth|fifth|top|upper|lower|ground)\s+$/i,
    requireAfter: /^\s+(?:building|house|home|block|structure|walk-?up|apartment|car\s?park)\b/i,
  }),
  ctx({
    from: 'stories',
    to: 'storeys',
    ruleId: 'spelling.contextual.storey',
    requireBefore: /\b(?:\d+|two|three|four|five|six|several)\s+$/i,
    requireAfter: /^\s+(?:tall|high|above|below|of\s+(?:offices|flats|apartments))\b/i,
  }),

  // ----- curb / kerb (the edge of a road) -----
  ctx({ from: 'curbside', to: 'kerbside', ruleId: 'spelling.contextual.kerb' }),
  ctx({ from: 'curbstone', to: 'kerbstone', ruleId: 'spelling.contextual.kerb' }),
  ctx({ from: 'curb appeal', to: 'kerb appeal', ruleId: 'spelling.contextual.kerb' }),
  ctx({ from: 'curb weight', to: 'kerb weight', ruleId: 'spelling.contextual.kerb' }),
  ctx({
    from: 'curb',
    to: 'kerb',
    ruleId: 'spelling.contextual.kerb',
    requireBefore: /\b(?:the|a|against the|onto the|off the|over the|up the|at the|by the|painted)\s+$/i,
    // The verb sense takes an object; the noun sense does not.
    forbidAfter:
      /^\s+(?:your|his|her|their|its|my|inflation|spending|costs?|emissions|growth|enthusiasm|appetite|abuse|access|the\b|a\b)/i,
  }),

  // ----- draft / draught. Only the beer, air and animal senses change. -----
  ...[
    ['draft beer', 'draught beer'],
    ['draft beers', 'draught beers'],
    ['draft ale', 'draught ale'],
    ['draft cider', 'draught cider'],
    ['draft guinness', 'draught guinness'],
    ['on draft', 'on draught'],
    ['draft horse', 'draught horse'],
    ['draft horses', 'draught horses'],
    ['draft excluder', 'draught excluder'],
    ['draft animal', 'draught animal'],
    ['draft animals', 'draught animals'],
    ['drafty', 'draughty'],
    ['draftier', 'draughtier'],
    ['draftiest', 'draughtiest'],
    ['draftsman', 'draughtsman'],
    ['draftsmen', 'draughtsmen'],
    ['draftsmanship', 'draughtsmanship'],
  ].map(([from, to]) => ctx({ from: from!, to: to!, ruleId: 'spelling.contextual.draught' })),

  // ----- disk / disc. A computer disk keeps its k. -----
  ...[
    ['compact disk', 'compact disc'],
    ['disk brake', 'disc brake'],
    ['disk brakes', 'disc brakes'],
    ['slipped disk', 'slipped disc'],
    ['herniated disk', 'herniated disc'],
    ['bulging disk', 'bulging disc'],
    ['disk golf', 'disc golf'],
    ['disk jockey', 'disc jockey'],
    ['spinal disk', 'spinal disc'],
  ].map(([from, to]) => ctx({ from: from!, to: to!, ruleId: 'spelling.contextual.disc' })),

  // ----- vise / vice (the tool) -----
  ...[
    ['bench vise', 'bench vice'],
    ['vise grip', 'vice grip'],
    ['vise grips', 'vice grips'],
    ['vise-like', 'vice-like'],
  ].map(([from, to]) => ctx({ from: from!, to: to!, ruleId: 'spelling.contextual.vice' })),

  // ----- meter / metre. Only the unit; a parking meter is a meter everywhere. -----
  ...(['meter', 'meters'] as const).map((from) =>
    ctx({
      from,
      to: from === 'meter' ? 'metre' : 'metres',
      ruleId: 'spelling.contextual.metre',
      requireBefore: /(?:\d\s*|\bsquare\s+|\bcubic\s+|\bper\s+)$/i,
      forbidBefore:
        /\b(?:parking|gas|water|electric|electricity|smart|taxi|postage|light|power|flow|ph|volt|amp|watt|utility|coin|prepayment)\s+$/i,
      forbidAfter: /^\s+(?:read(?:ing|ings|er|ers)?|box|maid|maids)\b/i,
    }),
  ),

  // The `-ed` past forms are not Americanisms. `burned`, `spelled`, `dreamed`, `spilled`
  // and `learned` are all ordinary Australian and British English, and `smelled` and
  // `leaned` are the usual forms here while `smelt` and `leant` read as dated. Only
  // `kneeled` and `leaped` are genuinely American, and those two need no context, so they
  // live in the plain irregular wordlist instead.

  // ----- `judgment` and `judgement` -----
  // A court's decision keeps the spelling without the e outside America too. The faculty
  // of judging does not, so the legal collocations are gated out.
  ...(['judgment', 'judgments'] as const).map((from) =>
    ctx({
      from,
      to: from === 'judgment' ? 'judgement' : 'judgements',
      ruleId: 'spelling.contextual.judgement',
      forbidBefore:
        /\b(?:summary|default|declaratory|consent|interlocutory|deficiency|money|foreign|enter|enters|entered|entering|hand down|hands down|handed down|handing down|reserve|reserved|deliver|delivered|render|rendered|vacate|vacated|affirm|affirmed|appeal|appealed|against)\s+$/i,
      forbidAfter: new RegExp(
        String.raw`^\s*(?:(?:debts?|creditors?|debtor|lien|roll|sum|order|notice|proof|day)\b` +
          String.raw`|was entered|is entered|in favou?r of` +
          String.raw`|of the (?:court|supreme|high|district|federal|circuit|county|appeal|tribunal|magistrate|judge))`,
        'i',
      ),
    }),
  ),

  ctx({
    from: 'gotten',
    to: 'got',
    ruleId: 'spelling.contextual.gotten',
    forbidBefore: /(?:ill|mis|for)-?$/i,
  }),
];
