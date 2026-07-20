import {
  extractWiktionaryExamples,
  extractWiktionarySynonyms,
  getEnglishWiktionarySection,
  getWiktionaryLemma,
  getWiktionaryTranslations,
  parseWiktionaryEntry,
} from '../wiktionary.js';

function assertEquals(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

const entries = {
  after: `==English==
===Adverb===
====Translations====
{{trans-top|later in time}}
* Russian: {{t|ru|после}}
{{trans-bottom}}
===Noun===
# A result shown after a treatment.`,
  before: `==English==
===Preposition===
====Translations====
{{trans-top|earlier than}}
* Russian: {{t|ru|до}}
{{trans-bottom}}
===Adverb===
====Translations====
{{trans-top|at an earlier time}}
* Russian: {{t|ru|раньше}}
{{trans-bottom}}
===Noun===
# A result shown before a treatment.`,
  do: `==English==
===Noun===
# A party or event.
===Verb===
====Translations====
{{trans-top|perform}}
* Russian: {{t|ru|делать}}
{{trans-bottom}}`,
  born: `==English==
===Etymology===
{{past participle of|en|bear}}
===Adjective===
====Translations====
{{trans-top|brought into life}}
* Russian: {{t|ru|рождённый}}
{{trans-bottom}}
===Verb===
{{head|en|verb form}}`,
  went: `==English==
===Etymology===
{{simple past of|en|go}}
===Verb===
{{head|en|verb form}}`,
  putOff: `==English==
===Verb===
====Translations====
{{trans-top|delay}}
* Russian: {{t|ru|откладывать}}, {{t|ru|[[переносить|переноси́ть]]}}
{{trans-bottom}}
====Synonyms====
{{syn|en|postpone|defer|track#Noun|[[mix#Noun|mix]]}}
#: {{ux|en|She put off the meeting.}}`,
  noTranslation: `==English==
===Noun===
# A word without a translation table.`,
  multipleEtymologies: `==English==
===Etymology 1===
From an unrelated noun.
===Noun===
====Translations====
{{trans-top|a written work}}
* Russian: {{t|ru|книга}}
{{trans-bottom}}
===Etymology 2===
{{simple past of|en|bake}}
===Verb===
{{head|en|verb form}}`,
};

Deno.test('selects translated adverb instead of untranslated noun for after', () => {
  assertEquals(parseWiktionaryEntry(entries.after, 'after').translation, 'после');
});

Deno.test('does not select a phrase-like noun meaning for before', () => {
  assertEquals(parseWiktionaryEntry(entries.before, 'before').translation, 'раньше');
});

Deno.test('prefers the semantic verb meaning of do', () => {
  assertEquals(parseWiktionaryEntry(entries.do, 'do').translation, 'делать');
});

Deno.test('keeps the independent adjective meaning of born', () => {
  assertEquals(parseWiktionaryEntry(entries.born, 'born').translation, 'рождённый');
  assertEquals(getWiktionaryLemma(getEnglishWiktionarySection(entries.born), 'born'), 'bear');
});

Deno.test('finds the lemma for a verb form without a standalone translation', () => {
  const english = getEnglishWiktionarySection(entries.went);
  assertEquals(parseWiktionaryEntry(entries.went, 'went').translation, '');
  assertEquals(getWiktionaryLemma(english, 'went'), 'go');
});

Deno.test('parses a phrasal verb and extracts its supporting content', () => {
  const english = getEnglishWiktionarySection(entries.putOff);
  assertEquals(parseWiktionaryEntry(entries.putOff, 'put off').translation, 'откладывать');
  assertEquals(getWiktionaryTranslations(getEnglishWiktionarySection(entries.putOff)), ['откладывать', 'переноси́ть']);
  assertEquals(parseWiktionaryEntry(entries.putOff, 'put off').otherTranslations, ['переноси́ть']);
  assertEquals(extractWiktionaryExamples(english), ['She put off the meeting.']);
  assertEquals(extractWiktionarySynonyms(english), ['postpone', 'defer', 'track', 'mix']);
});

Deno.test('returns an empty translation when the entry has no Russian translation table', () => {
  assertEquals(parseWiktionaryEntry(entries.noTranslation, 'untranslated').translation, '');
});

Deno.test('uses only the first etymology when looking up a lemma', () => {
  const english = getEnglishWiktionarySection(entries.multipleEtymologies);
  assertEquals(getWiktionaryLemma(english, 'booked'), '');
  assertEquals(parseWiktionaryEntry(entries.multipleEtymologies, 'booked').translation, 'книга');
});
