const $ = (selector) => document.querySelector(selector);
const DEFAULT_CONFIG = {
  url: 'https://kxpzkdrfsjusaeeipssg.supabase.co',
  key: 'sb_publishable_2Qw0ubk0lUuOuszN0cqdPA_x_m3HZYx',
};
const config = DEFAULT_CONFIG;
const PAGE_SIZE = 60;
const STUDY_PROMPTS = ['Одно слово — уже шаг.', 'Повторение делает сильнее.', 'Учите в своём ритме.', 'Небольшой шаг, большой словарь.', 'Сегодня слово — завтра уверенность.', 'Продолжайте, вы справляетесь.'];
const state = { cards: [], studyCards: null, totalCards: 0, isLoadingMore: false, isStudyLoading: false, currentIndex: null, recentStudyIds: [], seenStudyIds: new Set(), studyQueue: [], isStudyComplete: false, config };
let ignoreFlashcardClickUntil = 0;
let studyLoadPromise = null;
let addSuccessTimer = null;
let addSuccessHideTimer = null;
const lookupTimers = {};
const lookupControllers = {};

function apiHeaders() { return { apikey: state.config.key, Authorization: `Bearer ${state.config.key}`, 'Content-Type': 'application/json' }; }
function setSyncStatus(isConnected, message) { $('#sync-status').classList.toggle('is-connected', isConnected); $('#sync-status').classList.toggle('is-disconnected', !isConnected); $('#sync-status').setAttribute('aria-label', message); $('#sync-status').title = message; }
function setAppLoading(isLoading) { $('#app-loader').classList.toggle('is-hidden', !isLoading); $('#app-loader').setAttribute('aria-hidden', String(!isLoading)); }
async function request(path, options = {}) {
  const { withCount = false, ...requestOptions } = options;
  if (!state.config.url || !state.config.key) throw new Error('Подключите Supabase в настройках.');
  let response;
  try {
    response = await fetch(`${state.config.url}/rest/v1/${path}`, { ...requestOptions, headers: { ...apiHeaders(), ...requestOptions.headers } });
  } catch {
    throw new Error('Не удалось найти проект Supabase. Проверьте URL проекта.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Supabase отклонил ключ. Вставьте publishable/anon key из Settings → API.');
  if (response.status === 404) throw new Error('Таблица карточек не создана. Выполните supabase/schema.sql в SQL Editor.');
  if (!response.ok) throw new Error('Supabase пока недоступен. Проверьте настройки проекта.');
  const data = response.status === 204 ? null : await response.json();
  if (!withCount) return data;
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  return { data, total: Number.isFinite(total) ? total : 0 };
}
async function loadCards() {
  setAppLoading(true);
  state.cards = []; state.studyCards = null; state.totalCards = 0; state.currentIndex = null; state.recentStudyIds = []; state.seenStudyIds = new Set(); state.studyQueue = []; state.isStudyComplete = false;
  if (!state.config.url || !state.config.key) { render(); setAppLoading(false); return; }
  try { await loadMoreCards(); setSyncStatus(true, 'Общая база подключена'); }
  catch (error) { setSyncStatus(false, error.message); }
  render(); setAppLoading(false);
}
async function loadMoreCards() {
  if (state.isLoadingMore || state.cards.length >= state.totalCards && state.totalCards !== 0) return;
  state.isLoadingMore = true; render();
  try {
    const start = state.cards.length;
    const { data, total } = await request('cards?select=*&order=created_at.desc', { withCount: true, headers: { Range: `${start}-${start + PAGE_SIZE - 1}`, Prefer: 'count=exact' } });
    state.cards.push(...data); state.totalCards = total;
  } finally { state.isLoadingMore = false; render(); }
}
async function loadStudyCards() {
  if (state.studyCards) { if (state.currentIndex === null && !state.isStudyComplete) startStudySession(); else render(); return; }
  if (state.cards.length) {
    state.studyCards = [...state.cards];
    startStudySession();
    return;
  }
  if (studyLoadPromise) return studyLoadPromise;
  state.isStudyLoading = true; render();
  studyLoadPromise = (async () => {
    try {
      state.studyCards = await request('cards?select=*&order=created_at.desc');
      if (state.studyCards.length) startStudySession();
    } catch (error) { $('#study-empty').textContent = error.message; }
    finally { state.isStudyLoading = false; studyLoadPromise = null; render(); }
  })();
  return studyLoadPromise;
}
function escapeHtml(text = '') { const element = document.createElement('span'); element.textContent = text; return element.innerHTML; }
function fitStudyHeading(element) {
  element.style.fontSize = '';
  const availableWidth = element.parentElement.clientWidth - 70;
  const naturalWidth = element.scrollWidth;
  if (naturalWidth > availableWidth) {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${Math.max(18, Math.floor(fontSize * availableWidth / naturalWidth))}px`;
  }
}
function render() {
  $('#word-count').textContent = state.totalCards;
  $('#library-view').classList.toggle('has-cards', state.totalCards > 0);
  $('#empty-state').style.display = state.totalCards ? 'none' : 'block';
  $('#cards-list').innerHTML = state.cards.map(card => `<article class="word-card"><button class="edit" data-id="${card.id}" aria-label="Редактировать"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.4 15.9 4 20Z" /><path d="m13.9 7.5 3 3" /></svg></button><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="examples">${escapeHtml(card.examples || '')}</p><p class="synonyms">${card.synonyms ? `Синонимы: ${escapeHtml(card.synonyms)}` : ''}</p></article>`).join('');
  $('#load-more').hidden = state.cards.length >= state.totalCards || state.totalCards === 0;
  $('#load-more').disabled = state.isLoadingMore;
  $('#load-more').textContent = state.isLoadingMore ? 'Загружаем…' : 'Показать ещё';
  const card = state.studyCards?.[state.currentIndex];
  $('#study-loader').hidden = !state.isStudyLoading || !!card;
  $('#study-empty').style.display = card || state.isStudyLoading || state.isStudyComplete ? 'none' : 'block'; $('#flashcard').classList.toggle('has-card', !!card);
  $('#study-complete').hidden = !state.isStudyComplete;
  const totalStudyCards = state.studyCards?.length || 0;
  const shownStudyCards = state.seenStudyIds.size;
  $('#study-progress').hidden = !card && !state.isStudyComplete;
  $('#study-progress-count').textContent = `${shownStudyCards} из ${totalStudyCards}`;
  $('#study-progress-value').style.width = totalStudyCards ? `${shownStudyCards / totalStudyCards * 100}%` : '0%';
  $('#shuffle-study').hidden = !totalStudyCards;
  if (card) { const examples = card.examples || ''; const synonyms = card.synonyms ? `Синонимы: ${card.synonyms}` : ''; $('#study-word').textContent = card.word; $('#study-phonetic').textContent = card.phonetic || ''; $('#study-translation').textContent = card.translation; $('#study-examples').textContent = [examples, synonyms].filter(Boolean).join('\n'); $('#card-back').classList.toggle('has-long-definition', `${examples} ${synonyms}`.length > 110); fitStudyHeading($('#study-word')); fitStudyHeading($('#study-translation')); setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function setStudyPrompt() { $('#study-prompt').textContent = STUDY_PROMPTS[Math.floor(Math.random() * STUDY_PROMPTS.length)]; }
function switchView(name) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study') { setStudyPrompt(); if (state.totalCards) loadStudyCards(); } }
function getEnglishWiktionarySection(wikitext) {
  const section = wikitext.match(/(?:^|\n)==English==\s*\n([\s\S]*?)(?=\n==[^=][^\n]*==\s*(?:\n|$)|$)/);
  return section?.[1] || '';
}
function getWiktionaryPartOfSpeechSections(english, parts = 'Noun|Verb|Adjective|Adverb|Pronoun|Preposition|Conjunction|Interjection|Determiner|Article|Numeral|Proper noun') {
  const lines = english.split('\n');
  const sections = [];
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
    sections.push(lines.slice(start + 1, end).join('\n'));
  }
  return sections;
}
function getWiktionaryVerbSection(english) {
  const sections = getWiktionaryPartOfSpeechSections(english, 'Verb');
  return sections.find(section => /\{\{trans-(?:top|see)/i.test(section)) || sections.at(-1) || '';
}
function getPreferredWiktionarySection(english, word = '') {
  const sections = getWiktionaryPartOfSpeechSections(english);
  const verb = getWiktionaryVerbSection(english);
  if (verb && extractIrregularVerbForms(verb, word).length) return verb;
  return sections.find(section => getWiktionaryTranslation(section)) || sections[0] || english;
}
function decodeHtmlEntities(text) {
  const element = document.createElement('textarea');
  element.innerHTML = text;
  return element.value;
}
function getWiktionaryTranslation(section) {
  const blocks = [...section.matchAll(/\{\{trans-top(?:-see)?\|[^}]*\}\}([\s\S]*?)\{\{trans-bottom[^}]*\}\}/gi)];
  for (const block of blocks) {
    const translation = cleanWiktionaryText(block[1].match(/\{\{(?:t|tt)\+?\|ru\|([^|}]+)/i)?.[1] || '');
    if (translation) return translation;
  }
  return '';
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
function parseWiktionaryEntry(wikitext, word) {
  const english = getEnglishWiktionarySection(wikitext);
  const section = getPreferredWiktionarySection(english, word);
  const translation = getWiktionaryTranslation(section);
  return { translation, irregularForms: extractIrregularVerbForms(section, word) };
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
  if (!template) return [];
  if (!word) return [];
  const compact = template.match(/^[^|<]+<([^>]+)>/);
  const parts = (compact ? compact[1].split(',') : template.split('|')).map(part => part.trim());
  const pastIndex = compact ? 2 : parts.length >= 4 ? 2 : 2;
  const participleIndex = compact ? 3 : parts.length >= 4 ? 3 : 2;
  const regular = regularPastForm(word);
  const past = normalizeVerbForm(parts[pastIndex] || '', word, '', regular);
  const participle = normalizeVerbForm(parts[participleIndex] || '', word, past, regular);
  if (!past || !participle || (past === regular && participle === regular)) return [];
  return [...new Set([past, participle])];
}
function getWiktionaryLemma(english, sourceWord) {
  const template = english.match(/\{\{(?:inflection of|infl of|past participle of|simple past of|past tense of|present participle of|present tense of|third-person singular of|third-person singular simple present indicative form of|verb form of|plural of|comparative of|superlative of)\|en\|([^|}]+)/i)?.[1] || '';
  const lemma = cleanWiktionaryText(template.replace(/<[^>]*>/g, '')).split(',')[0].trim().toLowerCase();
  return lemma && lemma !== sourceWord.toLowerCase() ? lemma : '';
}
async function lookupFromWiktionary(word, signal, lookedUp = new Set()) {
  if (lookedUp.has(word)) throw new Error('Перевод не найден. Попробуйте другое слово или добавьте перевод вручную.');
  const visited = new Set(lookedUp).add(word);
  const url = new URL('https://en.wiktionary.org/w/api.php');
  url.search = new URLSearchParams({ action: 'parse', page: word, prop: 'wikitext', format: 'json', origin: '*' });
  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Не удалось связаться со словарём. Попробуйте ещё раз.');
  }
  if (!response.ok) throw new Error('Словарь временно недоступен. Попробуйте ещё раз.');
  const data = await response.json();
  const wikitext = data.parse?.wikitext?.['*'] || '';
  const allEnglish = getEnglishWiktionarySection(wikitext);
  const english = getPreferredWiktionarySection(allEnglish, word);
  const entry = parseWiktionaryEntry(wikitext, word);
  let translation = entry.translation;
  if (!translation) {
    const translationsUrl = new URL('https://en.wiktionary.org/w/api.php');
    translationsUrl.search = new URLSearchParams({ action: 'parse', page: `${word}/translations`, prop: 'wikitext', format: 'json', origin: '*' });
    const translationsResponse = await fetch(translationsUrl, { signal });
    if (translationsResponse.ok) {
      const translationsData = await translationsResponse.json();
      const translationSource = translationsData.parse?.wikitext?.['*'] || '';
      const translationsEnglish = getWiktionaryVerbSection(translationSource) || translationSource;
      translation = getWiktionaryTranslation(translationsEnglish);
    }
  }
  if (!translation) translation = getWiktionaryTranslation(allEnglish);
  if (!translation) {
    const lemma = getWiktionaryLemma(allEnglish, word);
    if (lemma) return lookupFromWiktionary(lemma, signal, visited);
  }
  if (!translation) throw new Error('Перевод не найден. Попробуйте другое слово или добавьте перевод вручную.');
  const forms = entry.irregularForms.length ? [`Формы: ${entry.irregularForms.join(', ')}.`] : [];
  return {
    translation,
    phonetic: '',
    examples: [...forms, ...extractWiktionaryExamples(english)].join('\n'),
    synonyms: extractWiktionarySynonyms(english).join(', ')
  };
}
function extractWiktionaryExamples(english) {
  return uniqueText([...english.matchAll(/\{\{ux\|en\|([^|}]+)/gi)].map(match => cleanWiktionaryText(match[1])), 2);
}
function extractWiktionarySynonyms(english) {
  const values = [...english.matchAll(/\{\{syn(?:onyms)?\|en\|([^}]+)/gi)]
    .flatMap(match => match[1].split('|'))
    .filter(value => value && !value.includes('='))
    .map(value => cleanWiktionaryText(value))
    .filter(value => !/^Thesaurus:/i.test(value));
  return uniqueText(values, 8);
}
$('.tabs').addEventListener('click', event => { const tab = event.target.closest('.tab'); if (tab) switchView(tab.dataset.view); });
$('#load-more').onclick = () => loadMoreCards().catch(error => alert(error.message));
function getCardFromForm(prefix, form) { return { word: $(`#${prefix}-word-input`).value.trim(), translation: $(`#${prefix}-translation-input`).value.trim(), examples: $(`#${prefix}-examples-input`).value.trim(), synonyms: $(`#${prefix}-synonyms-input`).value.trim(), phonetic: form.dataset.phonetic || '' }; }
function showAddSuccess() {
  const message = $('#add-success');
  clearTimeout(addSuccessTimer);
  clearTimeout(addSuccessHideTimer);
  message.classList.remove('is-leaving');
  message.hidden = false;
  addSuccessTimer = setTimeout(() => {
    message.classList.add('is-leaving');
    addSuccessHideTimer = setTimeout(() => {
      message.hidden = true;
      message.classList.remove('is-leaving');
    }, 160);
  }, 950);
}
function scheduleLookup(prefix, form) {
  clearTimeout(lookupTimers[prefix]);
  lookupControllers[prefix]?.abort();
  hideLookupMessage(prefix);
  const word = $(`#${prefix}-word-input`).value.trim();
  if (word.length < 2) return;
  lookupTimers[prefix] = setTimeout(() => fillCardFields(prefix, form), 500);
}
async function fillCardFields(prefix, form) {
  const word = $(`#${prefix}-word-input`).value.trim();
  if (word.length < 2) return;
  const saveButton = $(`#${prefix}-save-word`);
  const controller = new AbortController();
  lookupControllers[prefix] = controller;
  saveButton.disabled = true;
  $(`#${prefix}-lookup-loading`).classList.add('show');
  try {
    const data = await lookup(word, controller.signal);
    if (controller.signal.aborted || $(`#${prefix}-word-input`).value.trim() !== word) return;
    $(`#${prefix}-translation-input`).value = data.translation;
    $(`#${prefix}-examples-input`).value = data.examples;
    $(`#${prefix}-synonyms-input`).value = data.synonyms;
    form.dataset.phonetic = data.phonetic;
    hideLookupMessage(prefix);
  } catch (error) {
    if (error.name !== 'AbortError') showLookupMessage(prefix, getLookupErrorMessage(error));
  } finally {
    if (lookupControllers[prefix] === controller) {
      saveButton.disabled = false;
      $(`#${prefix}-lookup-loading`).classList.remove('show');
    }
  }
}
async function persistCard(card, editingId = '') {
  const result = await request(editingId ? `cards?id=eq.${editingId}` : 'cards', { method: editingId ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(card) });
  const savedCard = result?.[0];
  if (!savedCard) throw new Error(editingId ? 'Не удалось обновить карточку. В базе нужно разрешить изменение карточек.' : 'Не удалось сохранить карточку.');
  if (editingId) {
    state.cards = state.cards.map(item => item.id === editingId ? savedCard : item);
    if (state.studyCards) state.studyCards = state.studyCards.map(item => item.id === editingId ? savedCard : item);
  } else {
    state.cards.unshift(savedCard);
    if (state.cards.length > PAGE_SIZE) state.cards.pop();
    state.totalCards += 1;
    if (state.studyCards) state.studyCards.unshift(savedCard);
  }
  render();
}
function openEditDialog(card) {
  if (!card) return;
  const form = $('#edit-word-form');
  form.reset(); form.dataset.editingId = card.id; form.dataset.phonetic = card.phonetic || '';
  $('#edit-word-input').value = card.word;
  $('#edit-translation-input').value = card.translation;
  $('#edit-examples-input').value = card.examples || '';
  $('#edit-synonyms-input').value = card.synonyms || '';
  $('#edit-dialog').showModal();
  $('#edit-word-input').focus();
}
function validateRequiredFields(form) {
  form.querySelectorAll('.field-warning').forEach(warning => { warning.hidden = true; });
  form.querySelectorAll('[required]').forEach(field => field.classList.remove('is-invalid'));
  const missing = [...form.querySelectorAll('[required]')].find(field => !field.value.trim());
  if (!missing) return true;
  missing.classList.add('is-invalid');
  const warning = missing.closest('label')?.querySelector('.field-warning');
  if (warning) { warning.textContent = 'Заполните это поле.'; warning.hidden = false; }
  missing.focus();
  return false;
}
function clearFieldWarning(field) {
  field.classList.remove('is-invalid');
  const warning = field.closest('label')?.querySelector('.field-warning');
  if (warning) warning.hidden = true;
}
$('.close').onclick = () => $('#edit-dialog').close();
function normalizeWordInput(input) {
  const normalized = input.value.toLowerCase();
  if (input.value !== normalized) input.value = normalized;
}
$('#add-word-input').addEventListener('input', event => { normalizeWordInput(event.target); scheduleLookup('add', $('#add-word-form')); });
$('#edit-word-input').addEventListener('input', event => { normalizeWordInput(event.target); scheduleLookup('edit', $('#edit-word-form')); });
['#add-word-form', '#edit-word-form'].forEach(selector => {
  $(selector).addEventListener('input', event => {
    if (event.target.matches('[required]')) clearFieldWarning(event.target);
  });
});
$('#add-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateRequiredFields(form)) return;
  const card = getCardFromForm('add', form);
  try { await persistCard(card); form.reset(); form.dataset.phonetic = ''; showAddSuccess(); } catch (error) { alert(error.message); }
});
$('#edit-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateRequiredFields(form)) return;
  try { await persistCard(getCardFromForm('edit', form), form.dataset.editingId); $('#edit-dialog').close(); } catch (error) { alert(error.message); }
});
$('#cards-list').addEventListener('click', async event => { const editButton = event.target.closest('.edit'); if (editButton) { openEditDialog(state.cards.find(card => card.id === editButton.dataset.id)); return; } const button = event.target.closest('.remove'); if (!button || !confirm('Удалить карточку?')) return; try { await request(`cards?id=eq.${button.dataset.id}`, { method: 'DELETE' }); state.cards = state.cards.filter(card => card.id !== button.dataset.id); state.totalCards = Math.max(0, state.totalCards - 1); state.seenStudyIds.delete(button.dataset.id); state.studyQueue = state.studyQueue.filter(id => id !== button.dataset.id); if (state.studyCards) { state.studyCards = state.studyCards.filter(card => card.id !== button.dataset.id); if (!state.studyCards.length) state.isStudyComplete = false; if (state.currentIndex >= state.studyCards.length) state.currentIndex = null; } render(); } catch (error) { alert(error.message); } });
function shuffle(cards) { for (let index = cards.length - 1; index > 0; index -= 1) { const randomIndex = Math.floor(Math.random() * (index + 1)); [cards[index], cards[randomIndex]] = [cards[randomIndex], cards[index]]; } return cards; }
function startStudySession() { if (!state.studyCards?.length) return; state.studyQueue = shuffle(state.studyCards.map(card => card.id)); state.currentIndex = null; state.recentStudyIds = []; state.seenStudyIds = new Set(); state.isStudyComplete = false; chooseStudyCard(); render(); }
function chooseStudyCard() {
  if (!state.studyQueue.length) { state.currentIndex = null; state.isStudyComplete = true; return; }
  const nextId = state.studyQueue.shift();
  const card = state.studyCards.find(item => item.id === nextId);
  state.currentIndex = state.studyCards.findIndex(item => item.id === card.id);
  state.seenStudyIds.add(card.id);
}
function nextStudyCard() { chooseStudyCard(); render(); }
$('#shuffle-study').onclick = startStudySession;
function activateFlashcard() { if (!$('#flashcard').classList.contains('has-card')) return; $('#flashcard').classList.contains('is-flipped') ? nextStudyCard() : setCardFlipped(true); }
$('#flashcard').onclick = () => { if (Date.now() < ignoreFlashcardClickUntil) return; activateFlashcard(); };
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.code !== 'Space') return;
  if ($('#edit-dialog').open || event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  event.preventDefault();
  if (event.repeat) return;
  ignoreFlashcardClickUntil = Date.now() + 250;
  activateFlashcard();
});
loadCards();

function showLookupMessage(prefix, message) {
  const element = $(`#${prefix}-lookup-message`);
  element.textContent = message;
  element.hidden = false;
}
function hideLookupMessage(prefix) {
  const element = $(`#${prefix}-lookup-message`);
  element.hidden = true;
  element.textContent = '';
}
function getLookupErrorMessage(error) {
  const message = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(message)
    ? message
    : 'Не удалось получить данные из словаря. Попробуйте ещё раз.';
}
function uniqueText(values, limit = 8) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}
async function lookup(word, signal) {
  return lookupFromWiktionary(word, signal);
}
