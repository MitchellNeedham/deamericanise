import { describe, expect, it } from 'vitest';
import { deamericaniseText } from '../src/index.js';
import type { Dialect } from '../src/index.js';

// Vocabulary is the `localise` half of the package, so every case here opts in.
const au = (input: string, options = {}) =>
  deamericaniseText(input, { preset: 'localise', ...options });

describe('everyday vocabulary', () => {
  it.each`
    input                    | expected
    ${'gasoline'}            | ${'petrol'}
    ${'the gas station'}     | ${'the petrol station'}
    ${'the gas pedal'}       | ${'the accelerator'}
    ${'we ran out of gas'}   | ${'we ran out of petrol'}
    ${'the elevator'}        | ${'the lift'}
    ${'a cell phone'}        | ${'a mobile phone'}
    ${'my vacation'}         | ${'my holiday'}
    ${'the movie theater'}   | ${'the cinema'}
    ${'a zip code'}          | ${'a postcode'}
    ${'the drugstore'}       | ${'the chemist'}
    ${'the faucet'}          | ${'the tap'}
    ${'a flashlight'}        | ${'a torch'}
    ${'the garbage can'}     | ${'the rubbish bin'}
    ${'a parking lot'}       | ${'a car park'}
    ${'the windshield'}      | ${'the windscreen'}
    ${'turn signals'}        | ${'indicators'}
    ${'a diaper'}            | ${'a nappy'}
    ${'a stroller'}          | ${'a pram'}
    ${'the closet'}          | ${'the wardrobe'}
    ${'an eraser'}           | ${'a rubber'}
    ${'a sweater'}           | ${'a jumper'}
    ${'french fries'}        | ${'chips'}
    ${'cilantro'}            | ${'coriander'}
    ${'arugula'}             | ${'rocket'}
    ${'ground beef'}         | ${'beef mince'}
    ${'powdered sugar'}      | ${'icing sugar'}
    ${'a shopping cart'}     | ${'a trolley'}
    ${'the railroad'}        | ${'the railway'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('words gated on their context', () => {
  it.each`
    input                          | expected                         | why
    ${'in the fall of 2024'}       | ${'in the autumn of 2024'}        | ${'the season'}
    ${'last fall the team met'}    | ${'last autumn the team met'}     | ${'the season'}
    ${'take out the trash'}        | ${'take out the rubbish'}         | ${'household waste'}
    ${'waiting in line'}           | ${'waiting in the queue'}         | ${'a queue'}
    ${'buying gas'}                | ${'buying petrol'}                | ${'fuel'}
  `('$input -> $expected ($why)', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each`
    unchanged                       | why
    ${'prices will fall sharply'}   | ${'the verb'}
    ${'watch it fall'}              | ${'the verb'}
    ${'a gas giant'}                | ${'a state of matter'}
    ${'a gas leak in the mains'}    | ${'natural gas'}
    ${'the noble gas argon'}        | ${'chemistry'}
    ${'a line of code'}             | ${'not a queue'}
    ${'trash talk'}                 | ${'not household waste'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

describe('trailers', () => {
  it.each`
    input                    | expected
    ${'a trailer park'}      | ${'a caravan park'}
    ${'two trailer parks'}   | ${'two caravan parks'}
    ${'a travel trailer'}    | ${'a caravan'}
    ${'two travel trailers'} | ${'two caravans'}
    ${'a house trailer'}     | ${'a caravan'}
    ${'house trailers'}      | ${'caravans'}
    ${'a camping trailer'}   | ${'a caravan'}
    ${'camping trailers'}    | ${'caravans'}
    ${'a tractor trailer'}   | ${'a semi-trailer'}
    ${'a semi truck'}        | ${'a semi-trailer'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });

  it.each([
    'Watch the movie trailer.',
    'We hitched the boat trailer.',
    'a semi-trailer',
    'a box trailer',
    'a horse trailer',
    'the trailer hitch',
  ])('leaves "%s" alone', (input) => {
    expect(au(input)).toBe(input);
  });
});

describe('tuition', () => {
  it.each`
    input                   | expected
    ${'Paid tuition.'}      | ${'Paid tuition fees.'}
    ${'Paid tuition fees.'} | ${'Paid tuition fees.'}
    ${'Tuition Fees'}       | ${'Tuition Fees'}
    ${'the tuition fee'}    | ${'the tuition fee'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('school years', () => {
  it.each`
    input              | expected
    ${'5th grade'}     | ${'Year 5'}
    ${'1st grade'}     | ${'Year 1'}
    ${'twelfth grade'} | ${'Year 12'}
    ${'grade 3'}       | ${'Year 3'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('vocabulary can be switched off on its own', () => {
  it('leaves words alone but still fixes spelling', () => {
    expect(au('the gasoline color', { categories: { vocabulary: false } }))
      .toBe('the gasoline colour');
  });

  it('is off without the localise preset, which is the default', () => {
    expect(deamericaniseText('the gasoline color')).toBe('the gasoline colour');
  });
});

// `gas` is the most heavily gated word in the package: it is fuel, a state of matter, a
// utility and a weapon, and the wrong reading is nonsense rather than merely awkward.
describe('gas as fuel', () => {
  it.each`
    input                                 | expected
    ${'reduce the amount of gas you use'} | ${'reduce the amount of petrol you use'}
    ${'this saves gas'}                   | ${'this saves petrol'}
    ${'uses less gas'}                    | ${'uses less petrol'}
    ${'the cost of gas'}                  | ${'the cost of petrol'}
    ${'we ran out of gas'}                | ${'we ran out of petrol'}
    ${'spend less on gas'}                | ${'spend less on petrol'}
    ${'gas prices rose'}                  | ${'petrol prices rose'}
    ${'the gas station'}                  | ${'the petrol station'}
    ${'gas mileage'}                      | ${'fuel consumption'}
  `('$input -> $expected', ({ input, expected }) => {
    expect(au(input)).toBe(expected);
  });
});

describe('gas that is not fuel', () => {
  it.each`
    unchanged                          | why
    ${'natural gas prices rose'}       | ${'the utility, not the fuel'}
    ${'liquefied natural gas tank'}    | ${'the same'}
    ${'a natural gas pipeline'}        | ${'the same'}
    ${'shale gas production'}          | ${'the same'}
    ${'a gas giant'}                   | ${'a planet'}
    ${'the gas main'}                  | ${'the utility'}
    ${'a gas leak'}                    | ${'the utility'}
    ${'we use gas to heat the house'}  | ${'the utility'}
    ${'a gas stove'}                   | ${'the utility'}
    ${'gas turbine efficiency'}        | ${'machinery'}
    ${'the noble gas argon'}           | ${'chemistry'}
    ${'greenhouse gas emissions'}      | ${'emissions'}
    ${'the gas meter reading'}         | ${'a device'}
  `('leaves "$unchanged" alone ($why)', ({ unchanged }) => {
    expect(au(unchanged)).toBe(unchanged);
  });
});

// Every dialect with vocabulary. en-GB, en-IE and en-ZA also have a `postbox` row of their own.
const MAILBOX_DIALECTS: Dialect[] = ['en-AU', 'en-GB', 'en-NZ', 'en-IE', 'en-ZA'];

describe('an email or voicemail mailbox stays a mailbox', () => {
  it.each([
    'Your mailbox is full.',
    'Set up a shared mailbox in Outlook.',
    'The mailbox quota is 50 GB.',
    'a voicemail mailbox',
    'Your mailbox is almost full.',
    'Your mailbox is full. You might not be able to send or receive new items.',
    'Your mailbox has exceeded one or more size limits set by your administrator.',
    'Your mailbox is over its size limit.',
    "You can't send or receive email because your mailbox is full.",
    'Open a shared mailbox in Outlook on the web.',
    'Manage mailbox permissions.',
    'Automatic replies are turned on for this mailbox.',
    'Use Mailbox Cleanup to reduce the size of your mailbox.',
    'Free up mailbox space.',
    'This mailbox has been disabled.',
    'Convert a user mailbox to a shared mailbox.',
    'Create a room mailbox for each conference room.',
    'The mailbox database is offline.',
    'Run Get-Mailbox to list every mailbox.',
    'Move mailboxes to Exchange Online.',
    'Archive mailboxes have a separate quota.',
    'Public folder mailboxes',
    'Give a user Full Access permission to another mailbox.',
    'Mailbox size and quota',
    'Gmail stores every message in one mailbox.',
    'Your Gmail mailbox is almost out of storage.',
    'Add an IMAP mailbox in Thunderbird.',
    'Enter the server name for your POP3 mailbox.',
    'Sign in to your mailbox to read your messages.',
    'Forward mail from your old mailbox to support@example.com.',
    'In the Mail app, tap Mailboxes in the top left.',
    'Open Mail settings and choose Mailboxes.',
    'The mailbox is full and cannot accept any messages at this time.',
    'The voice mailbox you have reached is full.',
    'The mailbox you are trying to reach is full.',
    "The subscriber's mailbox is full.",
    'Dial *86 to check your mailbox.',
    'Set up your voicemail mailbox from your phone.',
    'You have 3 new messages in your mailbox.',
    'Choose a passcode for your mailbox.',
    'Your mailbox is 95% full.',
    'Your mailbox has reached its storage quota.',
    'Mailbox quota exceeded',
    'You are using 1.9 GB of your 2 GB mailbox.',
    'Your mailbox is approaching the size limit.',
    'The mailbox is over quota.',
    'Mailbox full',
    '550 5.2.2 mailbox full',
    'Mailbox unavailable',
    'Mailbox not found',
    'The recipient mailbox does not exist.',
    "The recipient's mailbox is full and can't accept messages now.",
    'Mailbox',
    'Mailboxes',
  ])('leaves "%s" alone', (input) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(input);
  });
});

describe('a mailbox for post still becomes a letterbox', () => {
  it.each`
    input                                                        | expected
    ${'Check the mailbox for the parcel.'}                       | ${'Check the letterbox for the parcel.'}
    ${'The mailbox is full of flyers.'}                          | ${'The letterbox is full of flyers.'}
    ${'Our mailbox is full of junk mail again.'}                 | ${'Our letterbox is full of junk mail again.'}
    ${'a mailbox full of letters'}                               | ${'a letterbox full of letters'}
    ${'Our mailbox fills up with flyers.'}                       | ${'Our letterbox fills up with flyers.'}
    ${'the mailbox'}                                             | ${'the letterbox'}
    ${'Put the letter in the mailbox.'}                          | ${'Put the letter in the letterbox.'}
    ${'He checked the mailbox at the end of the driveway.'}      | ${'He checked the letterbox at the end of the driveway.'}
    ${'A car knocked over our mailbox.'}                         | ${'A car knocked over our letterbox.'}
    ${'We share a mailbox with the neighbours.'}                 | ${'We share a letterbox with the neighbours.'}
    ${'Pop it in the mailbox on your way out.'}                  | ${'Pop it in the letterbox on your way out.'}
    ${'The mailbox key is on the hook.'}                         | ${'The letterbox key is on the hook.'}
    ${'Put a sign on the mailbox.'}                              | ${'Put a sign on the letterbox.'}
    ${'Mailboxes for sale'}                                      | ${'Letterboxes for sale'}
    ${'Your mailbox is full. Check the mailbox for the parcel.'} | ${'Your mailbox is full. Check the letterbox for the parcel.'}
  `('$input -> $expected', ({ input, expected }) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(expected);
  });
});
