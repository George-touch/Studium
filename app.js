import { db } from './database.js';

// Состояние приложения
let currentUser = null;
let currentTab = 'diary';
let currentFilter = 'all';
let flashcardIndex = 0;
let flashcards = [];
let testQuestions = [];
let currentQuestion = 0;
let testAnswers = [];

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Проверка сохраненной сессии
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        if (currentUser.role === 'teacher') {
            showTeacherScreen();
        } else {
            showStudentScreen();
        }
    }

    // Обработчики входа
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('teacherLogoutBtn').addEventListener('click', handleLogout);

    // Вкладки ученика
    document.querySelectorAll('#studentScreen .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Вкладки учителя
    document.querySelectorAll('#teacherScreen .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTeacherTab(btn.dataset.tab));
    });

    // Дневник
    document.getElementById('addDiaryBtn').addEventListener('click', addDiaryEntry);

    // Словарик
    document.getElementById('addWordBtn').addEventListener('click', addWord);
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => filterWords(btn.dataset.lang));
    });

    // Карточки
    document.getElementById('startCardsBtn').addEventListener('click', startFlashcards);

    // Тест
    document.getElementById('startTestBtn').addEventListener('click', startTest);

    // Учитель
    document.getElementById('addStudentBtn').addEventListener('click', addStudent);

    // Модальное окно
    document.querySelector('.close').addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target.id === 'studentModal') closeModal();
    });

    // Вкладки модального окна
    document.querySelectorAll('#studentModal .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchModalTab(btn.dataset.tab));
    });
}

// Вход/Выход
async function handleLogin(e) {
    e.preventDefault();
    const login = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    const result = await db.login(login, password);
    
    if (result.success) {
        currentUser = result.user;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        errorEl.textContent = '';
        
        if (currentUser.role === 'teacher') {
            showTeacherScreen();
        } else {
            showStudentScreen();
        }
    } else {
        errorEl.textContent = result.error;
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('loginForm').reset();
}

function showStudentScreen() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('studentScreen').classList.add('active');
    document.getElementById('studentName').textContent = currentUser.name;
    loadStudentData();
}

function showTeacherScreen() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('teacherScreen').classList.add('active');
    loadTeacherData();
}

// Переключение вкладок
function switchTab(tabName) {
    currentTab = tabName;
    
    document.querySelectorAll('#studentScreen .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    document.querySelectorAll('#studentScreen .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const tabs = {
        'diary': 'diaryTab',
        'vocabulary': 'vocabularyTab',
        'cards': 'cardsTab',
        'test': 'testTab'
    };
    
    document.getElementById(tabs[tabName]).classList.add('active');
}

function switchTeacherTab(tabName) {
    document.querySelectorAll('#teacherScreen .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    document.querySelectorAll('#teacherScreen .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const tabs = {
        'students': 'studentsTab',
        'manage': 'manageTab'
    };
    
    document.getElementById(tabs[tabName]).classList.add('active');
}

// Загрузка данных ученика
async function loadStudentData() {
    await loadDiary();
    await loadVocabulary();
}

// Дневник
async function loadDiary() {
    const entries = await db.getDiaryEntries(currentUser.id);
    const container = document.getElementById('diaryEntries');
    
    if (entries.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6B7280;">Записей пока нет</p>';
        return;
    }
    
    container.innerHTML = entries.map(entry => `
        <div class="entry-item">
            <div class="entry-date">${formatDate(entry.date)}</div>
            <div class="entry-text" id="entry-text-${entry.id}">${escapeHtml(entry.text)}</div>
            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <button class="btn-secondary" onclick="editDiaryEntry('${entry.id}', '${escapeHtml(entry.text).replace(/'/g, "\\'")}')">✏️ Редактировать</button>
                <button class="btn-danger" onclick="deleteDiaryEntry('${entry.id}')">Удалить</button>
            </div>
        </div>
    `).join('');
}

async function addDiaryEntry() {
    const text = document.getElementById('diaryText').value.trim();
    
    if (!text) {
        alert('Введите текст записи');
        return;
    }
    
    await db.addDiaryEntry(currentUser.id, text);
    document.getElementById('diaryText').value = '';
    await loadDiary();
}

// Словарик
async function loadVocabulary() {
    const words = await db.getWords(currentUser.id);
    displayWords(words);
}

function displayWords(words) {
    const container = document.getElementById('wordsList');
    
    const filtered = currentFilter === 'all' 
        ? words 
        : words.filter(w => w.language === currentFilter);
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6B7280;">Слов пока нет</p>';
        return;
    }
    
    container.innerHTML = filtered.map(word => `
        <div class="word-item">
            <div class="word-content">
                <div class="word-original">${escapeHtml(word.original)}</div>
                <div class="word-translation">${escapeHtml(word.translation)}</div>
                <span class="word-lang">${word.language === 'en' ? 'EN' : 'ES'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-secondary" onclick="editWord('${word.id}', '${word.language}', '${escapeHtml(word.original).replace(/'/g, "\\'")}', '${escapeHtml(word.translation).replace(/'/g, "\\'")}')">✏️</button>
                <button class="btn-danger" onclick="deleteWord('${word.id}')">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function addWord() {
    const language = document.getElementById('wordLanguage').value;
    const original = document.getElementById('wordOriginal').value.trim();
    const translation = document.getElementById('wordTranslation').value.trim();
    
    if (!original || !translation) {
        alert('Заполните все поля');
        return;
    }
    
    await db.addWord(currentUser.id, {
        language,
        original,
        translation
    });
    
    document.getElementById('wordOriginal').value = '';
    document.getElementById('wordTranslation').value = '';
    await loadVocabulary();
}

window.deleteWord = async function(wordId, studentId = null) {
    const userId = studentId || currentUser.id;
    if (confirm('Удалить это слово?')) {
        await db.deleteWord(userId, wordId);
        if (studentId) {
            // Учитель - обновить модальное окно
            await showStudentDetails(studentId);
        } else {
            // Ученик - обновить свой список
            await loadVocabulary();
        }
    }
}

window.editWord = async function(wordId, language, original, translation, studentId = null) {
    const userId = studentId || currentUser.id;
    const newOriginal = prompt('Слово на иностранном языке:', original);
    if (newOriginal === null) return;
    
    const newTranslation = prompt('Перевод:', translation);
    if (newTranslation === null) return;
    
    if (!newOriginal.trim() || !newTranslation.trim()) {
        alert('Поля не могут быть пустыми');
        return;
    }
    
    await db.updateWord(userId, wordId, {
        language,
        original: newOriginal.trim(),
        translation: newTranslation.trim()
    });
    
    if (studentId) {
        // Учитель - обновить модальное окно
        await showStudentDetails(studentId);
    } else {
        // Ученик - обновить свой список
        await loadVocabulary();
    }
}

window.deleteDiaryEntry = async function(entryId, studentId = null) {
    const userId = studentId || currentUser.id;
    if (confirm('Удалить эту запись?')) {
        await db.deleteDiaryEntry(userId, entryId);
        if (studentId) {
            // Учитель - обновить модальное окно
            await showStudentDetails(studentId);
        } else {
            // Ученик - обновить свой список
            await loadDiary();
        }
    }
}

window.editDiaryEntry = async function(entryId, text, studentId = null) {
    const userId = studentId || currentUser.id;
    const newText = prompt('Редактировать запись:', text);
    if (newText === null) return;
    
    if (!newText.trim()) {
        alert('Запись не может быть пустой');
        return;
    }
    
    await db.updateDiaryEntry(userId, entryId, newText.trim());
    
    if (studentId) {
        // Учитель - обновить модальное окно
        await showStudentDetails(studentId);
    } else {
        // Ученик - обновить свой список
        await loadDiary();
    }
}

function filterWords(lang) {
    currentFilter = lang;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    loadVocabulary();
}

// Карточки
async function startFlashcards() {
    const language = document.getElementById('cardsLanguage').value;
    const words = await db.getWords(currentUser.id);
    
    flashcards = language === 'all' 
        ? words 
        : words.filter(w => w.language === language);
    
    if (flashcards.length === 0) {
        alert('Добавьте слова в словарик');
        return;
    }
    
    flashcards = shuffleArray(flashcards);
    flashcardIndex = 0;
    showFlashcard();
}

function showFlashcard() {
    const container = document.getElementById('flashcardContainer');
    
    if (flashcardIndex >= flashcards.length) {
        container.innerHTML = `
            <div class="test-result">
                <h3>🎉 Отличная работа!</h3>
                <p>Вы повторили ${flashcards.length} слов</p>
                <button class="btn-primary" onclick="location.reload()">Повторить еще раз</button>
            </div>
        `;
        return;
    }
    
    const card = flashcards[flashcardIndex];
    let flipped = false;
    
    container.innerHTML = `
        <div class="flashcard-progress">
            Карточка ${flashcardIndex + 1} из ${flashcards.length}
        </div>
        <div class="flashcard" id="currentCard">
            <div class="flashcard-word">${escapeHtml(card.original)}</div>
            <div class="flashcard-hint">Нажмите, чтобы увидеть перевод</div>
        </div>
        <div class="flashcard-controls">
            <button class="btn-secondary" onclick="nextFlashcard()">Следующая →</button>
        </div>
    `;
    
    document.getElementById('currentCard').addEventListener('click', () => {
        const cardEl = document.getElementById('currentCard');
        if (!flipped) {
            cardEl.classList.add('flipped');
            cardEl.innerHTML = `
                <div class="flashcard-translation">${escapeHtml(card.translation)}</div>
            `;
            flipped = true;
        } else {
            cardEl.classList.remove('flipped');
            cardEl.innerHTML = `
                <div class="flashcard-word">${escapeHtml(card.original)}</div>
                <div class="flashcard-hint">Нажмите, чтобы увидеть перевод</div>
            `;
            flipped = false;
        }
    });
}

window.nextFlashcard = function() {
    flashcardIndex++;
    showFlashcard();
}

// Тест
async function startTest() {
    const language = document.getElementById('testLanguage').value;
    const count = parseInt(document.getElementById('testQuestions').value);
    const words = await db.getWords(currentUser.id);
    
    let availableWords = language === 'all' 
        ? words 
        : words.filter(w => w.language === language);
    
    if (availableWords.length < 4) {
        alert('Для теста нужно минимум 4 слова');
        return;
    }
    
    availableWords = shuffleArray(availableWords);
    testQuestions = availableWords.slice(0, Math.min(count, availableWords.length));
    currentQuestion = 0;
    testAnswers = [];
    
    showTestQuestion();
}

function showTestQuestion() {
    const container = document.getElementById('testContainer');
    
    if (currentQuestion >= testQuestions.length) {
        showTestResults();
        return;
    }
    
    const question = testQuestions[currentQuestion];
    const allWords = testQuestions.concat(
        shuffleArray(testQuestions).slice(0, 2)
    );
    const options = shuffleArray(
        Array.from(new Set(allWords.map(w => w.translation)))
    ).slice(0, 4);
    
    container.innerHTML = `
        <div class="test-question">
            <div class="question-number">Вопрос ${currentQuestion + 1} из ${testQuestions.length}</div>
            <div class="question-text">${escapeHtml(question.original)}</div>
            <div class="answer-options">
                ${options.map(opt => `
                    <div class="answer-option" onclick="selectAnswer('${escapeHtml(opt)}', '${escapeHtml(question.translation)}')">
                        ${escapeHtml(opt)}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

window.selectAnswer = function(selected, correct) {
    const isCorrect = selected === correct;
    testAnswers.push(isCorrect);
    
    document.querySelectorAll('.answer-option').forEach(opt => {
        opt.style.pointerEvents = 'none';
        if (opt.textContent.trim() === correct) {
            opt.classList.add('correct');
        } else if (opt.textContent.trim() === selected && !isCorrect) {
            opt.classList.add('incorrect');
        }
    });
    
    setTimeout(() => {
        currentQuestion++;
        showTestQuestion();
    }, 1500);
}

function showTestResults() {
    const container = document.getElementById('testContainer');
    const correctCount = testAnswers.filter(a => a).length;
    const percentage = Math.round((correctCount / testQuestions.length) * 100);
    
    container.innerHTML = `
        <div class="test-result">
            <h3>Тест завершен!</h3>
            <div class="result-score">${percentage}%</div>
            <p>Правильных ответов: ${correctCount} из ${testQuestions.length}</p>
            <button class="btn-primary" onclick="location.reload()">Пройти еще раз</button>
        </div>
    `;
}

// Панель учителя
async function loadTeacherData() {
    await loadStudentsList();
    await loadStudentsManage();
}

async function loadStudentsList() {
    const students = await db.getStudents();
    const container = document.getElementById('studentsList');
    
    if (students.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6B7280;">Учеников пока нет</p>';
        return;
    }
    
    const studentsWithStats = await Promise.all(
        students.map(async student => {
            const stats = await db.getStudentStats(student.id);
            return { ...student, ...stats };
        })
    );
    
    container.innerHTML = studentsWithStats.map(student => `
        <div class="student-card" onclick="showStudentDetails('${student.id}')">
            <div class="student-info">
                <h4>${escapeHtml(student.name)}</h4>
                <div class="student-stats">
                    <span>📝 Записей: ${student.diaryEntries}</span>
                    <span>📖 Слов: ${student.wordsCount}</span>
                    <span>${student.language === 'en' ? '🇬🇧 Английский' : student.language === 'es' ? '🇪🇸 Испанский' : '🌍 Оба языка'}</span>
                </div>
            </div>
            <div>→</div>
        </div>
    `).join('');
}

async function loadStudentsManage() {
    const students = await db.getStudents();
    const container = document.getElementById('studentsManageList');
    
    container.innerHTML = students.map(student => `
        <div class="student-manage-item">
            <div>
                <strong>${escapeHtml(student.name)}</strong> 
                (${escapeHtml(student.login)})
            </div>
            <button class="btn-danger" onclick="deleteStudent('${student.id}')">Удалить</button>
        </div>
    `).join('');
}

async function addStudent() {
    const name = document.getElementById('newStudentName').value.trim();
    const login = document.getElementById('newStudentLogin').value.trim();
    const password = document.getElementById('newStudentPassword').value.trim();
    const language = document.getElementById('newStudentLanguage').value;
    
    if (!name || !login || !password) {
        alert('Заполните все поля');
        return;
    }
    
    await db.addStudent({ name, login, password, language });
    
    document.getElementById('newStudentName').value = '';
    document.getElementById('newStudentLogin').value = '';
    document.getElementById('newStudentPassword').value = '';
    
    await loadTeacherData();
    alert(`Ученик добавлен!\nЛогин: ${login}\nПароль: ${password}`);
}

window.deleteStudent = async function(studentId) {
    if (confirm('Удалить этого ученика и все его данные?')) {
        await db.deleteStudent(studentId);
        await loadTeacherData();
    }
}

// Модальное окно с данными ученика
window.showStudentDetails = async function(studentId) {
    const students = await db.getStudents();
    const student = students.find(s => s.id === studentId);
    
    if (!student) return;
    
    document.getElementById('modalStudentName').textContent = student.name;
    
    // Загрузка дневника
    const diary = await db.getDiaryEntries(studentId);
    const diaryContainer = document.getElementById('modalDiaryContent');
    
    if (diary.length === 0) {
        diaryContainer.innerHTML = '<p style="text-align: center; color: #6B7280;">Записей нет</p>';
    } else {
        diaryContainer.innerHTML = diary.map(entry => `
            <div class="entry-item">
                <div class="entry-date">${formatDate(entry.date)}</div>
                <div class="entry-text">${escapeHtml(entry.text)}</div>
                <div style="margin-top: 12px; display: flex; gap: 8px;">
                    <button class="btn-secondary" onclick="editDiaryEntry('${entry.id}', '${escapeHtml(entry.text).replace(/'/g, "\\'")}', '${studentId}')">✏️ Редактировать</button>
                    <button class="btn-danger" onclick="deleteDiaryEntry('${entry.id}', '${studentId}')">Удалить</button>
                </div>
            </div>
        `).join('');
    }
    
    // Загрузка словаря
    const words = await db.getWords(studentId);
    const vocabContainer = document.getElementById('modalVocabularyContent');
    
    if (words.length === 0) {
        vocabContainer.innerHTML = '<p style="text-align: center; color: #6B7280;">Слов нет</p>';
    } else {
        vocabContainer.innerHTML = `
            <div class="words-list">
                ${words.map(word => `
                    <div class="word-item">
                        <div class="word-content">
                            <div class="word-original">${escapeHtml(word.original)}</div>
                            <div class="word-translation">${escapeHtml(word.translation)}</div>
                            <span class="word-lang">${word.language === 'en' ? 'EN' : 'ES'}</span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-secondary" onclick="editWord('${word.id}', '${word.language}', '${escapeHtml(word.original).replace(/'/g, "\\'")}', '${escapeHtml(word.translation).replace(/'/g, "\\'")}', '${studentId}')">✏️</button>
                            <button class="btn-danger" onclick="deleteWord('${word.id}', '${studentId}')">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    document.getElementById('studentModal').classList.add('active');
}

function closeModal() {
    document.getElementById('studentModal').classList.remove('active');
}

function switchModalTab(tabName) {
    document.querySelectorAll('#studentModal .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    document.getElementById('modalDiaryTab').classList.toggle('active', tabName === 'modalDiary');
    document.getElementById('modalVocabularyTab').classList.toggle('active', tabName === 'modalVocabulary');
}

// Утилиты
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}
