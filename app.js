import {
  extractWiktionaryExamples,
  extractWiktionarySynonyms,
  getEnglishWiktionarySection,
  getPreferredWiktionarySection,
  getRussianWiktionaryTranslation,
  getWiktionaryLemma,
  getWiktionaryTranslation,
  isCompatibleWiktionarySearchTitle,
  parseWiktionaryEntry,
} from './wiktionary.js?v=12';

const $ = (selector) => document.querySelector(selector);
const DEFAULT_CONFIG = {
  url: 'https://kxpzkdrfsjusaeeipssg.supabase.co',
  key: 'sb_publishable_2Qw0ubk0lUuOuszN0cqdPA_x_m3HZYx',
};
const config = DEFAULT_CONFIG;
const PAGE_SIZE = 60;
const MANUAL_TRANSLATION_MARKER = '__manual_translation__';
const STUDY_PROMPTS = ['Одно слово — уже шаг.', 'Повторение делает сильнее.', 'Учите в своём ритме.', 'Небольшой шаг, большой словарь.', 'Сегодня слово — завтра уверенность.', 'Продолжайте, вы справляетесь.'];
const state = { cards: [], studyCards: null, totalCards: 0, loadError: '', isLoadingMore: false, isStudyLoading: false, currentIndex: null, recentStudyIds: [], seenStudyIds: new Set(), studyQueue: [], isStudyComplete: false, config };
let ignoreFlashcardClickUntil = 0;
let studyLoadPromise = null;
let addSuccessTimer = null;
let addSuccessHideTimer = null;
const lookupTimers = {};
const lookupControllers = {};
const otherMeanings = new Map();
const pendingOtherMeanings = new Set();
const otherMeaningsQueue = [];
let activeOtherMeaningsRequests = 0;

function apiHeaders() { return { apikey: state.config.key, Authorization: `Bearer ${state.config.key}`, 'Content-Type': 'application/json' }; }
function setSyncStatus(isConnected, message) { $('#sync-status').classList.toggle('is-connected', isConnected); $('#sync-status').classList.toggle('is-disconnected', !isConnected); $('#sync-status').setAttribute('aria-label', message); $('#sync-status').title = message; }
function setAppLoading(isLoading) { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isLoading ? '#00BDBD' : '#f5f5f7'); document.documentElement.classList.toggle('is-splash-visible', isLoading); $('#app-loader').classList.toggle('is-hidden', !isLoading); $('#app-loader').setAttribute('aria-hidden', String(!isLoading)); }
async function request(path, options = {}) {
  const { withCount = false, ...requestOptions } = options;
  if (!state.config.url || !state.config.key) throw new Error('Не удалось подключиться к базе. Попробуйте обновить страницу.');
  let response;
  try {
    response = await fetch(`${state.config.url}/rest/v1/${path}`, { ...requestOptions, headers: { ...apiHeaders(), ...requestOptions.headers } });
  } catch {
    throw new Error('Не удалось подключиться к базе. Проверьте интернет-соединение и попробуйте обновить страницу.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Не удалось подключиться к базе. Попробуйте обновить страницу.');
  if (response.status === 404) throw new Error('База карточек сейчас недоступна. Попробуйте обновить страницу позже.');
  if (!response.ok) throw new Error('База карточек сейчас недоступна. Попробуйте обновить страницу позже.');
  const data = response.status === 204 ? null : await response.json();
  if (!withCount) return data;
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  return { data, total: Number.isFinite(total) ? total : 0 };
}
async function loadCards() {
  setAppLoading(true);
  state.cards = []; state.studyCards = null; state.totalCards = 0; state.loadError = ''; state.currentIndex = null; state.recentStudyIds = []; state.seenStudyIds = new Set(); state.studyQueue = []; state.isStudyComplete = false;
  if (!state.config.url || !state.config.key) {
    state.loadError = 'Не удалось подключиться к базе. Попробуйте обновить страницу.';
    setSyncStatus(false, state.loadError);
    render();
    setAppLoading(false);
    return;
  }
  try { await loadMoreCards(); setSyncStatus(true, 'Общая база подключена'); }
  catch (error) { state.loadError = error.message; setSyncStatus(false, error.message); }
  render(); setAppLoading(false);
}
async function loadMoreCards() {
  if (state.isLoadingMore || state.cards.length >= state.totalCards && state.totalCards !== 0) return;
  state.isLoadingMore = true; render();
  try {
    const start = state.cards.length;
    const { data, total } = await request('cards?select=*&order=created_at.desc', { withCount: true, headers: { Range: `${start}-${start + PAGE_SIZE - 1}`, Prefer: 'count=exact' } });
    state.cards.push(...data); state.totalCards = total; state.loadError = '';
  } catch (error) {
    state.loadError = error.message;
    throw error;
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
function hasManualTranslation(card) { return card.phonetic === MANUAL_TRANSLATION_MARKER; }
function fitStudyHeading(element) {
  element.style.fontSize = '';
  const availableWidth = element.parentElement.clientWidth - 70;
  const naturalWidth = element.scrollWidth;
  if (naturalWidth > availableWidth) {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${Math.max(18, Math.floor(fontSize * availableWidth / naturalWidth))}px`;
  }
}
function getStudyDetails(card) {
  const meanings = hasManualTranslation(card) ? '' : otherMeanings.get(card.word.toLowerCase()) || '';
  return { meanings, synonyms: card.synonyms ? `Синонимы: ${card.synonyms}` : '' };
}
function renderStudyDetails(card) {
  const details = getStudyDetails(card);
  $('#study-other-meanings').textContent = details.meanings;
  $('#study-other-meanings').hidden = !details.meanings;
  $('#study-synonyms').textContent = details.synonyms;
  $('#study-synonyms').hidden = !details.synonyms;
  $('#card-back').classList.toggle('has-long-definition', `${card.translation} ${details.meanings} ${details.synonyms}`.length > 110);
}
function updateLibraryOtherMeanings(word, meanings) {
  document.querySelectorAll('[data-other-meanings-word]').forEach(element => {
    if (element.dataset.otherMeaningsWord !== word) return;
    element.textContent = meanings;
    element.hidden = !meanings;
  });
}
function processOtherMeaningsQueue() {
  while (activeOtherMeaningsRequests < 3 && otherMeaningsQueue.length) {
    const card = otherMeaningsQueue.shift();
    activeOtherMeaningsRequests += 1;
    lookup(card.word)
      .then(data => otherMeanings.set(card.word.toLowerCase(), data.otherMeanings || ''))
      .catch(() => otherMeanings.set(card.word.toLowerCase(), ''))
      .finally(() => {
        const word = card.word.toLowerCase();
        const meanings = otherMeanings.get(word) || '';
        updateLibraryOtherMeanings(word, meanings);
        const currentCard = state.studyCards?.[state.currentIndex];
        if (currentCard?.id === card.id) renderStudyDetails(card);
        pendingOtherMeanings.delete(word);
        activeOtherMeaningsRequests -= 1;
        processOtherMeaningsQueue();
      });
  }
}
function loadOtherMeanings(card) {
  if (hasManualTranslation(card)) return;
  const word = card.word.toLowerCase();
  if (otherMeanings.has(word) || pendingOtherMeanings.has(word)) return;
  pendingOtherMeanings.add(word);
  otherMeaningsQueue.push(card);
  processOtherMeaningsQueue();
}
function render() {
  $('#word-count').textContent = state.totalCards;
  $('#library-view').classList.toggle('has-cards', state.totalCards > 0);
  $('#library-error').hidden = !state.loadError;
  $('#library-error-message').textContent = state.loadError;
  $('#empty-state').style.display = state.totalCards || state.loadError ? 'none' : 'block';
  $('#cards-list').innerHTML = state.cards.map(card => {
    const meanings = hasManualTranslation(card) ? '' : otherMeanings.get(card.word.toLowerCase()) || '';
    return `<article class="word-card"><button class="edit" data-id="${card.id}" aria-label="Редактировать"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.4 15.9 4 20Z" /><path d="m13.9 7.5 3 3" /></svg></button><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="examples">${escapeHtml(card.examples || '')}</p><p class="other-meanings" data-other-meanings-word="${escapeHtml(card.word.toLowerCase())}"${meanings ? '' : ' hidden'}>${escapeHtml(meanings)}</p><p class="synonyms">${card.synonyms ? `Синонимы: ${escapeHtml(card.synonyms)}` : ''}</p></article>`;
  }).join('');
  if ($('#library-view').classList.contains('is-active')) state.cards.filter(card => !hasManualTranslation(card)).forEach(loadOtherMeanings);
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
  if (card) { $('#study-word').textContent = card.word; $('#study-phonetic').textContent = hasManualTranslation(card) ? '' : card.phonetic || ''; $('#study-translation').textContent = card.translation; renderStudyDetails(card); loadOtherMeanings(card); fitStudyHeading($('#study-word')); fitStudyHeading($('#study-translation')); setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function setStudyPrompt() { $('#study-prompt').textContent = STUDY_PROMPTS[Math.floor(Math.random() * STUDY_PROMPTS.length)]; }
function switchView(name) { const activeElement = document.activeElement; if (activeElement instanceof HTMLElement) activeElement.blur(); document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study') { setStudyPrompt(); if (state.totalCards) loadStudyCards(); } if (name === 'library') render(); }
async function lookupRussianWiktionaryTranslation(word, signal) {
  try {
    const url = new URL('https://ru.wiktionary.org/w/api.php');
    url.search = new URLSearchParams({ action: 'parse', page: word, prop: 'wikitext', format: 'json', origin: '*' });
    const response = await fetch(url, { signal });
    if (!response.ok) return '';
    const data = await response.json();
    return getRussianWiktionaryTranslation(data.parse?.wikitext?.['*'] || '');
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return '';
  }
}
async function searchWiktionaryTitles(word, signal) {
  try {
    const url = new URL('https://en.wiktionary.org/w/api.php');
    url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: word, srnamespace: '0', srlimit: '5', format: 'json', origin: '*' });
    const response = await fetch(url, { signal });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.query?.search || []).map(result => result.title).filter(Boolean);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return [];
  }
}
async function lookupFromWiktionary(word, signal, lookedUp = new Set(), canSearch = true, preferVerb = false) {
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
  const entry = parseWiktionaryEntry(wikitext, word, preferVerb);
  let translation = entry.translation;
  const lemma = getWiktionaryLemma(allEnglish, word);
  if (!translation && lemma) return lookupFromWiktionary(lemma, signal, visited, canSearch, true);
  if (!translation) {
    const translationsUrl = new URL('https://en.wiktionary.org/w/api.php');
    translationsUrl.search = new URLSearchParams({ action: 'parse', page: `${word}/translations`, prop: 'wikitext', format: 'json', origin: '*' });
    const translationsResponse = await fetch(translationsUrl, { signal });
    if (translationsResponse.ok) {
      const translationsData = await translationsResponse.json();
      const translationSource = translationsData.parse?.wikitext?.['*'] || '';
      const translationsEnglish = getPreferredWiktionarySection(getEnglishWiktionarySection(translationSource), word, preferVerb) || translationSource;
      translation = getWiktionaryTranslation(translationsEnglish);
    }
  }
  if (!translation && canSearch) {
    const titles = await searchWiktionaryTitles(word, signal);
    for (const title of titles) {
      if (!isCompatibleWiktionarySearchTitle(title, word)) continue;
      if (visited.has(title.toLowerCase())) continue;
      try {
        return await lookupFromWiktionary(title, signal, visited, false, preferVerb);
      } catch (error) {
        if (error.name === 'AbortError') throw error;
      }
    }
  }
  if (!translation) translation = await lookupRussianWiktionaryTranslation(word, signal);
  if (!translation) throw new Error('Перевод не найден. Попробуйте другое слово или добавьте перевод вручную.');
  const forms = entry.irregularForms.length ? [`Формы: ${entry.irregularForms.join(', ')}.`] : [];
  return {
    translation,
    phonetic: '',
    examples: [...forms, ...extractWiktionaryExamples(allEnglish)].join('\n'),
    otherMeanings: entry.otherTranslations.join(', '),
    synonyms: extractWiktionarySynonyms(allEnglish).join(', ')
  };
}
const tabs = $('.tabs');
const tabsAnchor = document.createComment('tabs-anchor');
tabs.before(tabsAnchor);
const mobileTabsQuery = window.matchMedia('(max-width: 600px)');
function placeTabsForViewport() { if (mobileTabsQuery.matches) document.body.append(tabs); else tabsAnchor.after(tabs); }
mobileTabsQuery.addEventListener?.('change', placeTabsForViewport);
placeTabsForViewport();
tabs.addEventListener('click', event => { const tab = event.target.closest('.tab'); if (tab) switchView(tab.dataset.view); });
$('#load-more').onclick = () => loadMoreCards().catch(error => alert(error.message));
$('#retry-load').onclick = loadCards;
function setGeneratedField(prefix, name, value) {
  const content = String(value || '').trim();
  const input = $(`#${prefix}-${name}-input`);
  const text = $(`#${prefix}-${name}-text`);
  const field = $(`#${prefix}-${name}-field`);
  if (input) input.value = content;
  if (text) text.textContent = content;
  if (field) field.hidden = !content;
}
function setGeneratedFields(prefix, examples = '', otherMeanings = '', synonyms = '') {
  setGeneratedField(prefix, 'examples', examples);
  setGeneratedField(prefix, 'other-meanings', otherMeanings);
  setGeneratedField(prefix, 'synonyms', synonyms);
}
function clearGeneratedFields(prefix, form) {
  clearTimeout(lookupTimers[prefix]);
  lookupControllers[prefix]?.abort();
  form.dataset.phonetic = MANUAL_TRANSLATION_MARKER;
  setGeneratedFields(prefix);
}
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
  $(`#${prefix}-lookup-loading`)?.classList.add('show');
  try {
    const data = await lookup(word, controller.signal);
    if (controller.signal.aborted || $(`#${prefix}-word-input`).value.trim() !== word) return;
    $(`#${prefix}-translation-input`).value = data.translation;
    setGeneratedFields(prefix, data.examples, data.otherMeanings, data.synonyms);
    form.dataset.phonetic = data.phonetic;
    hideLookupMessage(prefix);
  } catch (error) {
    if (error.name !== 'AbortError') showLookupMessage(prefix, getLookupErrorMessage(error));
  } finally {
    if (lookupControllers[prefix] === controller) {
      saveButton.disabled = false;
      $(`#${prefix}-lookup-loading`)?.classList.remove('show');
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
  setGeneratedFields('edit', card.examples, '', card.synonyms);
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
$('#add-translation-input').addEventListener('input', () => clearGeneratedFields('add', $('#add-word-form')));
$('#edit-translation-input').addEventListener('input', () => clearGeneratedFields('edit', $('#edit-word-form')));
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
  try { await persistCard(card); form.reset(); form.dataset.phonetic = ''; setGeneratedFields('add'); showAddSuccess(); } catch (error) { alert(error.message); }
});
$('#edit-word-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateRequiredFields(form)) return;
  try { await persistCard(getCardFromForm('edit', form), form.dataset.editingId); $('#edit-dialog').close(); } catch (error) { alert(error.message); }
});
function confirmCardDeletion() { const dialog = $('#delete-dialog'); return new Promise(resolve => { const onClose = () => { dialog.removeEventListener('close', onClose); resolve(dialog.returnValue === 'confirm'); }; dialog.addEventListener('close', onClose); dialog.showModal(); }); }
$('#cards-list').addEventListener('click', async event => { const editButton = event.target.closest('.edit'); if (editButton) { openEditDialog(state.cards.find(card => card.id === editButton.dataset.id)); return; } const button = event.target.closest('.remove'); if (!button || !await confirmCardDeletion()) return; try { await request(`cards?id=eq.${button.dataset.id}`, { method: 'DELETE' }); state.cards = state.cards.filter(card => card.id !== button.dataset.id); state.totalCards = Math.max(0, state.totalCards - 1); state.seenStudyIds.delete(button.dataset.id); state.studyQueue = state.studyQueue.filter(id => id !== button.dataset.id); if (state.studyCards) { state.studyCards = state.studyCards.filter(card => card.id !== button.dataset.id); if (!state.studyCards.length) state.isStudyComplete = false; if (state.currentIndex >= state.studyCards.length) state.currentIndex = null; } render(); } catch (error) { alert(error.message); } });
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
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
}
function hideLookupMessage(prefix) {
  const element = $(`#${prefix}-lookup-message`);
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}
function getLookupErrorMessage(error) {
  const message = String(error?.message || '');
  return /[А-Яа-яЁё]/.test(message)
    ? message
    : 'Не удалось получить данные из словаря. Попробуйте ещё раз.';
}
async function lookup(word, signal) {
  return lookupFromWiktionary(word, signal);
}
