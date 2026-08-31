import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';

const au = (input: string) => deamericaniseText(input);

describe('-or becomes -our', () => {
  it.each`
    input                       | expected
    ${'color'}                  | ${'colour'}
    ${'colors'}                 | ${'colours'}
    ${'colored'}                | ${'coloured'}
    ${'colorful'}               | ${'colourful'}
    ${'discoloration'}          | ${'discolouration'}
    ${'watercolor'}             | ${'watercolour'}
    ${'honor'}                  | ${'honour'}
    ${'honorable'}              | ${'honourable'}
    ${'labor'}                  | ${'labour'}
    ${'laborer'}                | ${'labourer'}
    ${'favorite'}               | ${'favourite'}
    ${'favorable'}              | ${'favourable'}
    ${'favoritism'}             | ${'favouritism'}
    ${'flavorsome'}             | ${'flavoursome'}
    ${'neighborhood'}           | ${'neighbourhood'}
    ${'behavioral'}             | ${'behavioural'}
    ${'armory'}                 | ${'armoury'}
    ${'savory'}                 | ${'savoury'}
    ${'endeavor'}               | ${'endeavour'}
    ${'misdemeanor'}            | ${'misdemeanour'}
    ${'colorize'}               | ${'colourise'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged        | why
    ${'humorous'}    | ${'the -ous form drops the u in every dialect'}
    ${'vigorous'}    | ${'same'}
    ${'glamorous'}   | ${'same'}
    ${'laborious'}   | ${'same'}
    ${'laboratory'}  | ${'same'}
    ${'honorary'}    | ${'never takes a u'}
    ${'odorous'}     | ${'same'}
    ${'deodorant'}   | ${'same'}
    ${'vaporise'}    | ${'vapour, but vaporise'}
    ${'colorimetry'} | ${'a different word entirely'}
    ${'doctor'}      | ${'not an -our word'}
    ${'motor'}       | ${'not an -our word'}
    ${'error'}       | ${'not an -our word'}
    ${'tremor'}      | ${'identical in every dialect'}
    ${'liquor'}      | ${'identical in every dialect'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('-er becomes -re', () => {
  it.each`
    input               | expected
    ${'center'}         | ${'centre'}
    ${'centered'}       | ${'centred'}
    ${'centering'}      | ${'centring'}
    ${'centerpiece'}    | ${'centrepiece'}
    ${'epicenter'}      | ${'epicentre'}
    ${'theater'}        | ${'theatre'}
    ${'amphitheater'}   | ${'amphitheatre'}
    ${'fiber'}          | ${'fibre'}
    ${'fiberglass'}     | ${'fibreglass'}
    ${'maneuver'}       | ${'manoeuvre'}
    ${'maneuvering'}    | ${'manoeuvring'}
    ${'maneuverable'}   | ${'manoeuvrable'}
    ${'caliber'}        | ${'calibre'}
    ${'somber'}         | ${'sombre'}
    ${'meager'}         | ${'meagre'}
    ${'specter'}        | ${'spectre'}
    ${'lackluster'}     | ${'lacklustre'}
    ${'kilometer'}      | ${'kilometre'}
    ${'centimeters'}    | ${'centimetres'}
    ${'liter'}          | ${'litre'}
    ${'milliliters'}    | ${'millilitres'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged        | why
    ${'central'}     | ${'the -re only appears in the noun'}
    ${'theatrical'}  | ${'same'}
    ${'fibrous'}     | ${'same'}
    ${'thermometer'} | ${'an instrument, not the SI unit'}
    ${'diameter'}    | ${'not a unit at all'}
    ${'parameter'}   | ${'not a unit at all'}
    ${'speedometer'} | ${'an instrument'}
    ${'voltmeter'}   | ${'an instrument'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('-ize becomes -ise', () => {
  it.each`
    input                | expected
    ${'organize'}        | ${'organise'}
    ${'organized'}       | ${'organised'}
    ${'organizing'}      | ${'organising'}
    ${'organization'}    | ${'organisation'}
    ${'organizational'}  | ${'organisational'}
    ${'recognize'}       | ${'recognise'}
    ${'apologize'}       | ${'apologise'}
    ${'customizable'}    | ${'customisable'}
    ${'tokenizer'}       | ${'tokeniser'}
    ${'prioritization'}  | ${'prioritisation'}
    ${'analyze'}         | ${'analyse'}
    ${'analyzed'}        | ${'analysed'}
    ${'analyzer'}        | ${'analyser'}
    ${'paralyze'}        | ${'paralyse'}
    ${'catalyzing'}      | ${'catalysing'}
    ${'ORGANIZE'}        | ${'ORGANISE'}
    ${'Organized'}       | ${'Organised'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged      | why
    ${'size'}      | ${'iz is part of the stem'}
    ${'sizes'}     | ${'same'}
    ${'resize'}    | ${'same'}
    ${'resizable'} | ${'same'}
    ${'downsized'} | ${'same'}
    ${'oversized'} | ${'same'}
    ${'capsize'}   | ${'same'}
    ${'prize'}     | ${'a prize is not a prise'}
    ${'seize'}     | ${'same'}
    ${'maize'}     | ${'same'}
    ${'citizen'}   | ${'no -ize suffix'}
    ${'horizon'}   | ${'no -ize suffix'}
    ${'wizard'}    | ${'no -ize suffix'}
    ${'grizzly'}   | ${'no -ize suffix'}
    ${'bizarre'}   | ${'no -ize suffix'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('doubled and single l', () => {
  it.each`
    input             | expected
    ${'canceled'}     | ${'cancelled'}
    ${'canceling'}    | ${'cancelling'}
    ${'cancelation'}  | ${'cancellation'}
    ${'traveled'}     | ${'travelled'}
    ${'traveler'}     | ${'traveller'}
    ${'traveling'}    | ${'travelling'}
    ${'labeled'}      | ${'labelled'}
    ${'modeling'}     | ${'modelling'}
    ${'fueled'}       | ${'fuelled'}
    ${'signaling'}    | ${'signalling'}
    ${'totaled'}      | ${'totalled'}
    ${'counselor'}    | ${'counsellor'}
    ${'marvelous'}    | ${'marvellous'}
    ${'medalist'}     | ${'medallist'}
    ${'panelists'}    | ${'panellists'}
    ${'worshiped'}    | ${'worshipped'}
    ${'enrollment'}   | ${'enrolment'}
    ${'fulfill'}      | ${'fulfil'}
    ${'fulfillment'}  | ${'fulfilment'}
    ${'installment'}  | ${'instalment'}
    ${'skillful'}     | ${'skilful'}
    ${'willfully'}    | ${'wilfully'}
    ${'distill'}      | ${'distil'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged        | why
    ${'rebelled'}    | ${'stress on the last syllable doubles in America too'}
    ${'compelled'}   | ${'same'}
    ${'controlled'}  | ${'same'}
    ${'patrolled'}   | ${'same'}
    ${'peeled'}      | ${'not an -el verb'}
    ${'revealed'}    | ${'not an -el verb'}
    ${'feeling'}     | ${'not an -el verb'}
    ${'dealer'}      | ${'not an -el verb'}
    ${'fulfilled'}   | ${'already correct'}
    ${'enrolled'}    | ${'already correct'}
  `('leaves $unchanged alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('other spelling families', () => {
  it.each`
    family            | input               | expected
    ${'-ence'}        | ${'defense'}        | ${'defence'}
    ${'-ence'}        | ${'offenses'}       | ${'offences'}
    ${'-ence'}        | ${'pretense'}       | ${'pretence'}
    ${'-ogue'}        | ${'catalog'}        | ${'catalogue'}
    ${'-ogue'}        | ${'cataloged'}      | ${'catalogued'}
    ${'-ogue'}        | ${'monologue'}      | ${'monologue'}
    ${'-ogue'}        | ${'epilog'}         | ${'epilogue'}
    ${'digraph'}      | ${'esthetic'}       | ${'aesthetic'}
    ${'digraph'}      | ${'anesthesia'}     | ${'anaesthesia'}
    ${'digraph'}      | ${'archeology'}     | ${'archaeology'}
    ${'digraph'}      | ${'pediatrician'}   | ${'paediatrician'}
    ${'digraph'}      | ${'hemorrhage'}     | ${'haemorrhage'}
    ${'digraph'}      | ${'leukemia'}       | ${'leukaemia'}
    ${'digraph'}      | ${'diarrhea'}       | ${'diarrhoea'}
    ${'digraph'}      | ${'esophagus'}      | ${'oesophagus'}
    ${'digraph'}      | ${'celiac'}         | ${'coeliac'}
    ${'irregular'}    | ${'aluminum'}       | ${'aluminium'}
    ${'irregular'}    | ${'math'}           | ${'maths'}
    ${'irregular'}    | ${'airplane'}       | ${'aeroplane'}
    ${'irregular'}    | ${'pajamas'}        | ${'pyjamas'}
    ${'irregular'}    | ${'mustache'}       | ${'moustache'}
    ${'irregular'}    | ${'yogurt'}         | ${'yoghurt'}
    ${'irregular'}    | ${'donuts'}         | ${'doughnuts'}
    ${'irregular'}    | ${'skeptical'}      | ${'sceptical'}
    ${'irregular'}    | ${'plowed'}         | ${'ploughed'}
    ${'irregular'}    | ${'moldy'}          | ${'mouldy'}
    ${'irregular'}    | ${'smoldering'}     | ${'smouldering'}
    ${'irregular'}    | ${'grayscale'}      | ${'greyscale'}
    ${'irregular'}    | ${'jewelry'}        | ${'jewellery'}
    ${'irregular'}    | ${'judgment'}       | ${'judgement'}
    ${'irregular'}    | ${'normalcy'}       | ${'normality'}
    ${'irregular'}    | ${'specialty'}      | ${'speciality'}
    ${'irregular'}    | ${'aging'}          | ${'ageing'}
    ${'irregular'}    | ${'cozy'}           | ${'cosy'}
  `('$family: $input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('whole sentences', () => {
  it.each`
    input                                                              | expected
    ${'The color of the theater center was gray.'}                     | ${'The colour of the theatre centre was grey.'}
    ${'They organized a defense and canceled the labeled program.'}    | ${'They organised a defence and cancelled the labelled program.'}
    ${'Our neighbor favors aluminum fiberglass armor.'}                | ${'Our neighbour favours aluminium fibreglass armour.'}
  `('$input', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});
