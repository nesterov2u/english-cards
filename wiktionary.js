function getWiktionaryPartOfSpeechEntries(english, parts = 'Noun|Verb|Adjective|Adverb|Pronoun|Preposition|Conjunction|Interjection|Determiner|Article|Numeral|Proper noun') {
  const lines = english.split('\n');
  const entries = [];
  const headingPattern = new RegExp(`^(={3,})(?:${parts})\\1\\s*$`, 'i');
  for (let start = 0; start < lines.length; start += 1) {
    const heading = lines[start].match(headingPattern);
    if (!heading) continue;
    const level = heading[1].length;
    let end = start + 1;
    while (end < lines.length) {
      const nextHeading = lines[end].match(/^(={3,})[^=].*?\1\s*$/);
      if (nextHeading && nextHeading[1].length <= level) break;
      end += 1;
    }
    entries.push({ part: lines[start].replace(/=/g, '').trim(), content: lines.slice(start + 1, end).join('\n') });
  }
  return entries;
}

function hasWiktionaryTranslationReference(section) {
  return /\{\{trans-(?:top|see)/i.test(section);
}

function getWiktionaryTranslatableEntries(english) {
  return getWiktionaryPartOfSpeechEntries(english).filter(entry =>
    hasWiktionaryTranslationReference(entry.content) && getWiktionaryTranslation(entry.content)
  );
}

function getWiktionaryVerbSection(english) {
  return getWiktionaryTranslatableEntries(english).find(entry => entry.part.toLowerCase() === 'verb')?.content || '';
}

function decodeHtmlEntities(text) {
  if (typeof document === 'undefined') return text;
  const element = document.createElement('textarea');
  element.innerHTML = text;
  return element.value;
}

function cleanWiktionaryText(text) {
  let value = text;
  while (/\{\{[^{}]*\}\}/.test(value)) value = value.replace(/\{\{[^{}]*\}\}/g, '');
  return decodeHtmlEntities(value)
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/''+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEnglishWiktionarySection(wikitext) {
  const section = wikitext.match(/(?:^|\n)==English==\s*\n([\s\S]*?)(?=\n==[^=][^\n]*==\s*(?:\n|$)|$)/);
  return section?.[1] || '';
}

export function getWiktionaryTranslations(section) {
  const blocks = [...section.matchAll(/\{\{trans-top(?:-see)?\|[^}]*\}\}([\s\S]*?)\{\{trans-bottom[^}]*\}\}/gi)];
  const translations = blocks.flatMap(block => {
    const label = cleanWiktionaryText(block[0].match(/\{\{trans-top(?:-see)?\|([^}|]+)/i)?.[1] || '');
    return [...block[1].matchAll(/\{\{(?:t|tt)\+?\|ru\|([\s\S]*?)\}\}/gi)]
      .map(match => ({ label, value: cleanWiktionaryText(splitWiktionaryParameters(match[1])[0] || '') }))
      .filter(item => item.value);
  });
  const semanticTranslation = translations.find(item => !/^(?:in |for |as |used |auxiliary|pro-verb|grammatical|syntactic|emphasis|question|negation)/i.test(item.label));
  const primary = semanticTranslation || translations[0];
  if (!primary) return [];
  return [...new Set([primary.value, ...translations.map(item => item.value)])];
}

export function getWiktionaryTranslation(section) {
  return getWiktionaryTranslations(section)[0] || '';
}

export function getWiktionaryLemma(english, sourceWord) {
  const primaryEtymology = english.match(/(?:^|\n)===Etymology(?: \d+)?===\s*\n([\s\S]*?)(?=\n===Etymology(?: \d+)?===|$)/i)?.[1] || english;
  const template = primaryEtymology.match(/\{\{(?:inflection of|infl of|past participle of|simple past of|past tense of|present participle of|present tense of|third-person singular of|third-person singular simple present indicative form of|verb form of|plural of|comparative of|superlative of)\|en\|([^|}]+)/i)?.[1] || '';
  const lemma = cleanWiktionaryText(template.replace(/<[^>]*>/g, '')).split(',')[0].trim().toLowerCase();
  return lemma && lemma !== sourceWord.toLowerCase() ? lemma : '';
}

export function getPreferredWiktionarySection(english, word = '', preferVerb = false) {
  const entries = getWiktionaryTranslatableEntries(english);
  const verb = getWiktionaryVerbSection(english);
  const coreVerbs = new Set(['be', 'do', 'go', 'have', 'make', 'take', 'get', 'give', 'come', 'know', 'think', 'see', 'want', 'use', 'find', 'tell', 'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call']);
  const lemma = getWiktionaryLemma(english, word);
  if (lemma) {
    const adjective = entries.find(entry => entry.part.toLowerCase() === 'adjective');
    if (adjective) return adjective.content;
    if (verb) return verb;
  }
  if (verb && (preferVerb || coreVerbs.has(word.toLowerCase()))) return verb;
  const preferredParts = ['Noun', 'Adjective', 'Adverb', 'Verb', 'Proper noun', 'Pronoun', 'Determiner', 'Article', 'Numeral', 'Preposition', 'Conjunction', 'Interjection'];
  for (const part of preferredParts) {
    const entry = entries.find(item => item.part.toLowerCase() === part.toLowerCase());
    if (entry) return entry.content;
  }
  return entries[0]?.content || '';
}

function regularPastForm(word) {
  if (!/^[a-z]+$/.test(word)) return '';
  if (word.endsWith('e')) return `${word}d`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ied`;
  return `${word}ed`;
}

function normalizeVerbForm(value, word, previous = '', regular = '') {
  const alternatives = value.replace(/<[^>]*>|\[[^\]]*\]/g, '').split(',').map(item => item.split(':')[0].trim()).filter(Boolean);
  let form = alternatives.find(item => item !== '+') || alternatives[0] || '';
  if (!form || form === '-') return '';
  if (form === '+') return regular || previous || word;
  if (form.startsWith('~')) form = `${word}${form.slice(1)}`;
  else if (/^[a-z]{1,2}$/i.test(form)) form = `${word}${form}`;
  return cleanWiktionaryText(form).trim().toLowerCase();
}

function extractIrregularVerbForms(english, sourceWord) {
  const word = sourceWord.toLowerCase();
  if (word === 'be') return ['was/were', 'been'];
  const template = english.match(/\{\{en-verb\|([^{}]+)\}\}/i)?.[1];
  if (!template || !word) return [];
  const compact = template.match(/^[^|<]+<([^>]+)>/);
  const parts = (compact ? compact[1].split(',') : template.split('|')).map(part => part.trim());
  const past = normalizeVerbForm(parts[2] || '', word, '', regularPastForm(word));
  const participle = normalizeVerbForm(parts[compact ? 3 : parts.length >= 4 ? 3 : 2] || '', word, past, regularPastForm(word));
  if (!past || !participle || (past === regularPastForm(word) && participle === regularPastForm(word))) return [];
  return [...new Set([past, participle])];
}

export function parseWiktionaryEntry(wikitext, word, preferVerb = false) {
  const english = getEnglishWiktionarySection(wikitext);
  const section = getPreferredWiktionarySection(english, word, preferVerb);
  const translations = getWiktionaryTranslations(section);
  return { translation: translations[0] || '', otherTranslations: translations.slice(1), irregularForms: extractIrregularVerbForms(section, word) };
}

export function getRussianWiktionaryTranslation(wikitext) {
  const english = wikitext.match(/(?:^|\n)=\s*\{\{-en-\}\}\s*=\s*\n([\s\S]*?)(?=\n=\s*\{\{-[a-z-]+-\}\}\s*=|$)/i)?.[1] || '';
  const definition = english.match(/==== Значение ====\s*\n#\s*(.+?)(?=\n#|\n====|$)/s)?.[1] || '';
  return cleanWiktionaryText(definition);
}

export function isCompatibleWiktionarySearchTitle(title, word) {
  const normalize = value => value.toLocaleLowerCase('en').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\s.'’_-]+/g, '');
  const normalizedWord = normalize(word);
  return normalizedWord && normalize(title) === normalizedWord;
}

function uniqueText(values, limit = 8) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function splitWiktionaryParameters(value) {
  const parameters = [];
  let start = 0;
  let linkDepth = 0;
  let templateDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const pair = value.slice(index, index + 2);
    if (pair === '[[') { linkDepth += 1; index += 1; continue; }
    if (pair === ']]' && linkDepth) { linkDepth -= 1; index += 1; continue; }
    if (pair === '{{') { templateDepth += 1; index += 1; continue; }
    if (pair === '}}' && templateDepth) { templateDepth -= 1; index += 1; continue; }
    if (value[index] === '|' && !linkDepth && !templateDepth) {
      parameters.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parameters.push(value.slice(start));
  return parameters;
}

export function extractWiktionaryExamples(english) {
  return uniqueText([...english.matchAll(/\{\{ux\|en\|([^|}]+)/gi)].map(match => cleanWiktionaryText(match[1])), 2);
}

export function extractWiktionarySynonyms(english) {
  const values = [...english.matchAll(/\{\{syn(?:onyms)?\|en\|([^}]+)/gi)]
    .flatMap(match => splitWiktionaryParameters(match[1]))
    .filter(value => value && !value.includes('='))
    .map(value => value.replace(/#[^|\]\s]+/g, ''))
    .map(value => cleanWiktionaryText(value))
    .filter(value => !/^Thesaurus:/i.test(value));
  return uniqueText(values, 8);
}
