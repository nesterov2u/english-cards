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
  $('#cards-list').innerHTML = state.cards.map(card => `<article class="word-card"><button class="edit" data-id="${card.id}" aria-label="Редактировать"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.4 15.9 4 20Z" /><path d="m13.9 7.5 3 3" /></svg></button><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="definition">${escapeHtml(card.definition || '')}</p></article>`).join('');
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
  if (card) { const definition = card.definition || ''; $('#study-word').textContent = card.word; $('#study-phonetic').textContent = card.phonetic || ''; $('#study-translation').textContent = card.translation; $('#study-definition').textContent = definition; $('#card-back').classList.toggle('has-long-definition', definition.length > 110); fitStudyHeading($('#study-word')); fitStudyHeading($('#study-translation')); setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function setStudyPrompt() { $('#study-prompt').textContent = STUDY_PROMPTS[Math.floor(Math.random() * STUDY_PROMPTS.length)]; }
function switchView(name) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study') { setStudyPrompt(); if (state.totalCards) loadStudyCards(); } }
async function translateWithMyMemory(text, signal) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.search = new URLSearchParams({ q: text, langpair: 'en|ru', mt: '1' });
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Перевод не получен.');
  const data = await response.json();
  return data.responseData?.translatedText || '';
}
function getEnglishWiktionarySection(wikitext) {
  const section = wikitext.match(/(?:^|\n)==English==\s*\n([\s\S]*?)(?=\n==[^=][^\n]*==\s*(?:\n|$)|$)/);
  return section?.[1] || '';
}
function cleanWiktionaryText(text) {
  let value = text;
  while (/\{\{[^{}]*\}\}/.test(value)) value = value.replace(/\{\{[^{}]*\}\}/g, '');
  return value
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/''+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractGrammarDescription(html, word) {
  const content = document.createElement('div');
  content.innerHTML = html;
  const heading = [...content.querySelectorAll('h3')].find(item => /(?:Тип|Морфологические) и синтаксические свойства/.test(item.textContent));
  const section = heading?.closest('.mw-heading');
  if (!section) return '';
  const normalizedWord = word.replace(/\s+/g, ' ').trim().toLowerCase();
  let current = section.nextElementSibling;
  while (current && !current.matches('.mw-heading')) {
    if (current.matches('p')) {
      const text = current.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.toLowerCase() !== normalizedWord) return text;
    }
    current = current.nextElementSibling;
  }
  return '';
}
async function lookupGrammarDescription(word, signal) {
  try {
    const url = new URL('https://ru.wiktionary.org/w/api.php');
    url.search = new URLSearchParams({ action: 'parse', page: word, prop: 'text', format: 'json', origin: '*' });
    const response = await fetch(url, { signal });
    if (!response.ok) return '';
    const data = await response.json();
    return extractGrammarDescription(data.parse?.text?.['*'] || '', word);
  } catch { return ''; }
}
function parseWiktionaryEntry(wikitext) {
  const english = getEnglishWiktionarySection(wikitext);
  const definitionMatch = english.match(/^#(?![:*])\s*(.+)$/m);
  const translationBlock = english.match(/\{\{trans-top\|[^}]*\}\}([\s\S]*?)\{\{trans-bottom[^}]*\}\}/i);
  const translationMatch = translationBlock?.[1].match(/\{\{t\+?\|ru\|([^|}]+)/i);
  const definition = cleanWiktionaryText(definitionMatch?.[1] || '');
  const translation = cleanWiktionaryText(translationMatch?.[1] || '');
  if (!definition || !translation) throw new Error('В Wiktionary не нашлось подходящего значения.');
  return { definition, translation };
}
async function lookupFromWiktionary(word, signal) {
  const url = new URL('https://en.wiktionary.org/w/api.php');
  url.search = new URLSearchParams({ action: 'parse', page: word, prop: 'wikitext', format: 'json', origin: '*' });
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Wiktionary недоступен.');
  const data = await response.json();
  const { translation } = parseWiktionaryEntry(data.parse?.wikitext?.['*'] || '');
  return { translation, phonetic: '' };
}
async function lookupFromLegacySources(word, signal) {
  const [translationResponse, dictionaryResponse] = await Promise.all([
    translateWithMyMemory(word, signal), fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal })
  ]);
  let dictionary = null;
  if (dictionaryResponse.ok) dictionary = await dictionaryResponse.json();
  return { translation: translationResponse, phonetic: dictionary?.[0]?.phonetic || dictionary?.[0]?.phonetics?.find(item => item.text)?.text || '' };
}
async function lookup(word, signal) {
  const grammarDescription = lookupGrammarDescription(word, signal);
  try {
    const result = await lookupFromWiktionary(word, signal);
    return { ...result, definition: await grammarDescription };
  } catch {
    const result = await lookupFromLegacySources(word, signal);
    return { ...result, definition: await grammarDescription };
  }
}
$('.tabs').addEventListener('click', event => { const tab = event.target.closest('.tab'); if (tab) switchView(tab.dataset.view); });
$('#load-more').onclick = () => loadMoreCards().catch(error => alert(error.message));
function getCardFromForm(prefix, form) { return { word: $(`#${prefix}-word-input`).value.trim(), translation: $(`#${prefix}-translation-input`).value.trim(), definition: $(`#${prefix}-definition-input`).value.trim(), phonetic: form.dataset.phonetic || '' }; }
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
  const word = $(`#${prefix}-word-input`).value.trim();
  if (word.length < 3) return;
  lookupTimers[prefix] = setTimeout(() => fillCardFields(prefix, form), 500);
}
async function fillCardFields(prefix, form) {
  const word = $(`#${prefix}-word-input`).value.trim();
  if (word.length < 3) return;
  const saveButton = $(`#${prefix}-save-word`);
  const controller = new AbortController();
  lookupControllers[prefix] = controller;
  saveButton.disabled = true;
  $(`#${prefix}-lookup-loading`).classList.add('show');
  try {
    const data = await lookup(word, controller.signal);
    if (controller.signal.aborted || $(`#${prefix}-word-input`).value.trim() !== word) return;
    $(`#${prefix}-translation-input`).value = data.translation;
    $(`#${prefix}-definition-input`).value = data.definition;
    form.dataset.phonetic = data.phonetic;
  } catch (error) {
    if (error.name !== 'AbortError') alert(`${error.message} Заполните перевод вручную.`);
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
  $('#edit-definition-input').value = card.definition || '';
  $('#edit-dialog').showModal();
  $('#edit-word-input').focus();
}
$('.close').onclick = () => $('#edit-dialog').close();
$('#add-word-input').addEventListener('input', () => scheduleLookup('add', $('#add-word-form')));
$('#edit-word-input').addEventListener('input', () => scheduleLookup('edit', $('#edit-word-form')));
$('#add-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const card = getCardFromForm('add', form);
  try { await persistCard(card); form.reset(); form.dataset.phonetic = ''; showAddSuccess(); } catch (error) { alert(error.message); }
});
$('#edit-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
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
