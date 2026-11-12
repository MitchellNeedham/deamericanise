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

// Gmail, Outlook, Google Drive and macOS name a folder `Trash`. Windows names its one the Recycle Bin.
describe('the trash of an email client or file manager stays the trash', () => {
  it.each([
    'Move it to the Trash folder.',
    'Empty the trash in Gmail.',
    'Drag the file to the Trash.',
    'Restore the email from the trash.',
    'Messages in the trash are deleted forever after 30 days.',
    'Outlook moves the email to the trash.',
    "If you don't see the Deleted Items folder, but instead see the Trash folder, your account doesn't support it.",
    'Files you move to the Trash are deleted forever after 30 days.',
    'To put a file in the Trash:',
    'Any files you put in the trash are put in the trash everywhere.',
    'Empty the trash in Google Drive.',
    'Restore it from the trash in Dropbox.',
    "You start by dragging items to the Trash in the Dock, but the items aren't deleted until you empty the Trash.",
    'Empty the Trash',
    'On your Mac, click the Trash icon in the Dock.',
    'Items that you move to the Trash from your Mac remain until you empty the Trash.',
    'You can choose to automatically empty the Trash in Finder settings.',
    'Remove items from the Trash after 30 days.',
    'Drag it to the trash.',
    'Windows calls the trash the Recycle Bin.',
    'Click the Trash can icon.',
    'Press the trash button.',
    'Tap the trash can to delete the email.',
    'Items in the Trash can be restored.',
  ])('leaves "%s" alone', (input) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(input);
  });
});

describe('household trash still becomes rubbish', () => {
  it.each`
    input                                                   | expected
    ${'take out the trash'}                                 | ${'take out the rubbish'}
    ${'Put the trash out on Tuesday.'}                      | ${'Put the rubbish out on Tuesday.'}
    ${'The trash goes out on Thursday night.'}              | ${'The rubbish goes out on Thursday night.'}
    ${'Throw the wrapper in the trash.'}                    | ${'Throw the wrapper in the rubbish.'}
    ${'Household trash is collected weekly.'}               | ${'Household rubbish is collected weekly.'}
    ${'Put the trash cans out on Tuesday.'}                 | ${'Put the rubbish bins out on Tuesday.'}
    ${'Trash cans go out on Tuesday.'}                      | ${'Rubbish bins go out on Tuesday.'}
    ${'Drag the trash cans down the driveway.'}             | ${'Drag the rubbish bins down the driveway.'}
    ${'The kids put the trash in the trash can.'}           | ${'The kids put the rubbish in the rubbish bin.'}
    ${'TAKE OUT THE TRASH'}                                 | ${'TAKE OUT THE RUBBISH'}
    ${'Empty the trash in Gmail. Then take out the trash.'} | ${'Empty the trash in Gmail. Then take out the rubbish.'}
  `('$input -> $expected', ({ input, expected }) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(expected);
  });

  it('leaves "trash talk" alone', () => {
    for (const dialect of MAILBOX_DIALECTS) expect(au('trash talk', { dialect }), dialect).toBe('trash talk');
  });
});

describe("Gmail's Vacation responder keeps its name", () => {
  it.each([
    'Turn on the vacation responder in Gmail settings.',
    'Vacation responder',
    'Vacation responder on',
    'Under the "General" tab, go to the "Vacation responder" section.',
    'When your vacation responder is on, a banner shows across the top of your inbox.',
    'Set up a vacation responder',
    'Gmail Vacation Responder',
    'Set up a vacation auto-responder.',
  ])('leaves "%s" alone', (input) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(input);
  });
});

describe('a vacation is still a holiday', () => {
  it.each`
    input                           | expected
    ${'my vacation'}                | ${'my holiday'}
    ${'Plan your summer vacation.'} | ${'Plan your summer holiday.'}
    ${'vacationing in Bali'}        | ${'holidaying in Bali'}
    ${'Book a vacation before you turn on the vacation responder.'} | ${'Book a holiday before you turn on the vacation responder.'}
  `('$input -> $expected', ({ input, expected }) => {
    for (const dialect of MAILBOX_DIALECTS) expect(au(input, { dialect }), dialect).toBe(expected);
  });
});
