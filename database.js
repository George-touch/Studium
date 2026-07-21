// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBSetwQLsdLqsHOsI069zsc32F8L9H2fVA",
    authDomain: "studium-5f4fa.firebaseapp.com",
    projectId: "studium-5f4fa",
    storageBucket: "studium-5f4fa.firebasestorage.app",
    messagingSenderId: "697791889187",
    appId: "1:697791889187:web:c979e9d743250ed61ed696",
    databaseURL: "https://studium-5f4fa-default-rtdb.europe-west1.firebasedatabase.app"
};

// Проверка доступности Firebase
let useFirebase = false;
let firebaseApp = null;
let database = null;

try {
    // Импорт Firebase (используем CDN версию через script теги в HTML)
    if (typeof firebase !== 'undefined') {
        firebaseApp = firebase.initializeApp(firebaseConfig);
        database = firebase.database();
        useFirebase = true;
        console.log('✅ Firebase подключен успешно!');
    }
} catch (error) {
    console.warn('⚠️ Firebase не доступен, используем локальное хранилище:', error);
    useFirebase = false;
}

// Класс для работы с базой данных (Firebase + localStorage fallback)
class Database {
    constructor() {
        this.useFirebase = useFirebase;
        
        // Если Firebase недоступен - используем localStorage
        if (!this.useFirebase) {
            this.initLocalStorage();
        }
    }

    initLocalStorage() {
        this.users = this.loadData('users') || {
            'teacher': {
                id: 'teacher',
                name: 'Учитель',
                login: 'teacher',
                password: 'teacher123',
                role: 'teacher'
            }
        };
        this.students = this.loadData('students') || {};
        this.diaries = this.loadData('diaries') || {};
        this.vocabularies = this.loadData('vocabularies') || {};
        this.boards = this.loadData('boards') || {};
        this.saveData('users', this.users);
    }

    loadData(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    }

    saveData(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    // Hash password (простой SHA-256)
    async hashPassword(password) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // =============== FIREBASE МЕТОДЫ ===============

    async firebaseLogin(login, password) {
        const hashedPassword = await this.hashPassword(password);
        const snapshot = await database.ref('users').orderByChild('login').equalTo(login).once('value');
        const users = snapshot.val();
        
        if (users) {
            const userId = Object.keys(users)[0];
            const user = users[userId];
            
            if (user.password === hashedPassword) {
                const userData = { ...user };
                delete userData.password;
                return { success: true, user: userData };
            }
        }
        return { success: false, error: 'Неверный логин или пароль' };
    }

    async firebaseRegisterTeacher(teacherData) {
        // Проверка существования логина
        const snapshot = await database.ref('users').orderByChild('login').equalTo(teacherData.login).once('value');
        if (snapshot.val()) {
            return { success: false, error: 'Логин уже занят' };
        }

        const hashedPassword = await this.hashPassword(teacherData.password);
        const newTeacherRef = database.ref('users').push();
        const id = newTeacherRef.key;
        
        const userData = {
            id,
            name: teacherData.name,
            login: teacherData.login,
            password: hashedPassword,
            role: 'teacher',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await newTeacherRef.set(userData);
        return { success: true, teacherId: id };
    }

    async firebaseAddStudent(studentData, teacherId) {
        const hashedPassword = await this.hashPassword(studentData.password);
        const newStudentRef = database.ref('users').push();
        const id = newStudentRef.key;
        
        const userData = {
            id,
            name: studentData.name,
            login: studentData.login,
            password: hashedPassword,
            language: studentData.language,
            role: 'student',
            teacherId: teacherId, // Привязка к учителю
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await newStudentRef.set(userData);
        await database.ref(`students/${id}`).set({
            id,
            name: studentData.name,
            login: studentData.login,
            language: studentData.language,
            teacherId: teacherId, // Привязка к учителю
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        return { success: true, studentId: id };
    }

    async firebaseGetStudents(teacherId) {
        const snapshot = await database.ref('students').orderByChild('teacherId').equalTo(teacherId).once('value');
        const students = snapshot.val();
        return students ? Object.values(students) : [];
    }

    async firebaseDeleteStudent(studentId) {
        await database.ref(`users/${studentId}`).remove();
        await database.ref(`students/${studentId}`).remove();
        await database.ref(`diaries/${studentId}`).remove();
        await database.ref(`vocabularies/${studentId}`).remove();
        return { success: true };
    }

    async firebaseAddDiaryEntry(userId, text) {
        const newEntryRef = database.ref(`diaries/${userId}`).push();
        const entry = {
            id: newEntryRef.key,
            text,
            date: firebase.database.ServerValue.TIMESTAMP
        };
        await newEntryRef.set(entry);
        return { success: true, entry: { ...entry, date: new Date().toISOString() } };
    }

    async firebaseGetDiaryEntries(userId) {
        const snapshot = await database.ref(`diaries/${userId}`).orderByChild('date').once('value');
        const entries = snapshot.val();
        if (!entries) return [];
        
        return Object.values(entries).sort((a, b) => b.date - a.date);
    }

    async firebaseAddWord(userId, wordData) {
        const newWordRef = database.ref(`vocabularies/${userId}`).push();
        const word = {
            id: newWordRef.key,
            ...wordData,
            correctCount: 0,
            incorrectCount: 0,
            category: null, // A, B, C или null
            addedAt: firebase.database.ServerValue.TIMESTAMP
        };
        await newWordRef.set(word);
        return { success: true, word: { ...word, addedAt: new Date().toISOString() } };
    }

    async firebaseGetWords(userId) {
        const snapshot = await database.ref(`vocabularies/${userId}`).once('value');
        const words = snapshot.val();
        return words ? Object.values(words) : [];
    }

    async firebaseDeleteWord(userId, wordId) {
        await database.ref(`vocabularies/${userId}/${wordId}`).remove();
        return { success: true };
    }

    async firebaseUpdateWord(userId, wordId, wordData) {
        await database.ref(`vocabularies/${userId}/${wordId}`).update(wordData);
        return { success: true };
    }

    async firebaseUpdateWordStats(userId, wordId, isCorrect) {
        const wordRef = database.ref(`vocabularies/${userId}/${wordId}`);
        const snapshot = await wordRef.once('value');
        const word = snapshot.val();
        
        if (word) {
            if (isCorrect) {
                await wordRef.update({ 
                    correctCount: (word.correctCount || 0) + 1 
                });
            } else {
                await wordRef.update({ 
                    incorrectCount: (word.incorrectCount || 0) + 1 
                });
            }
        }
        return { success: true };
    }

    async firebaseUpdateWordCategory(userId, wordId, category) {
        await database.ref(`vocabularies/${userId}/${wordId}`).update({ category });
        return { success: true };
    }

    async firebaseUpdateDiaryEntry(userId, entryId, text) {
        await database.ref(`diaries/${userId}/${entryId}`).update({ text });
        return { success: true };
    }

    async firebaseDeleteDiaryEntry(userId, entryId) {
        await database.ref(`diaries/${userId}/${entryId}`).remove();
        return { success: true };
    }

    async firebaseSaveBoard(boardId, elements) {
        await database.ref(`boards/${boardId}`).set({
            elements,
            updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
        return { success: true };
    }

    async firebaseGetBoard(boardId) {
        const snapshot = await database.ref(`boards/${boardId}`).once('value');
        const data = snapshot.val();
        return data && data.elements ? data.elements : [];
    }

    async firebaseGetStudentStats(studentId) {
        const [diarySnapshot, wordsSnapshot] = await Promise.all([
            database.ref(`diaries/${studentId}`).once('value'),
            database.ref(`vocabularies/${studentId}`).once('value')
        ]);
        
        const diaries = diarySnapshot.val();
        const words = wordsSnapshot.val();
        
        return {
            diaryEntries: diaries ? Object.keys(diaries).length : 0,
            wordsCount: words ? Object.keys(words).length : 0
        };
    }

    // =============== ЛОКАЛЬНЫЕ МЕТОДЫ ===============

    async localLogin(login, password) {
        const user = Object.values(this.users).find(
            u => u.login === login && u.password === password
        );
        if (user) {
            const userData = { ...user };
            delete userData.password;
            return { success: true, user: userData };
        }
        return { success: false, error: 'Неверный логин или пароль' };
    }

    async localRegisterTeacher(teacherData) {
        // Проверка существования логина
        const existingUser = Object.values(this.users).find(u => u.login === teacherData.login);
        if (existingUser) {
            return { success: false, error: 'Логин уже занят' };
        }

        const id = 'teacher_' + Date.now();
        this.users[id] = {
            id,
            name: teacherData.name,
            login: teacherData.login,
            password: teacherData.password,
            role: 'teacher',
            createdAt: new Date().toISOString()
        };
        
        this.saveData('users', this.users);
        return { success: true, teacherId: id };
    }

    async localAddStudent(studentData, teacherId) {
        const id = 'student_' + Date.now();
        this.users[id] = {
            id,
            ...studentData,
            role: 'student',
            teacherId: teacherId
        };
        this.students[id] = {
            id,
            name: studentData.name,
            login: studentData.login,
            language: studentData.language,
            teacherId: teacherId,
            createdAt: new Date().toISOString()
        };
        this.diaries[id] = [];
        this.vocabularies[id] = [];
        
        this.saveData('users', this.users);
        this.saveData('students', this.students);
        this.saveData('diaries', this.diaries);
        this.saveData('vocabularies', this.vocabularies);
        
        return { success: true, studentId: id };
    }

    async localGetStudents(teacherId) {
        return Object.values(this.students).filter(s => s.teacherId === teacherId);
    }

    async localDeleteStudent(studentId) {
        delete this.users[studentId];
        delete this.students[studentId];
        delete this.diaries[studentId];
        delete this.vocabularies[studentId];
        
        this.saveData('users', this.users);
        this.saveData('students', this.students);
        this.saveData('diaries', this.diaries);
        this.saveData('vocabularies', this.vocabularies);
        
        return { success: true };
    }

    async localAddDiaryEntry(userId, text) {
        if (!this.diaries[userId]) {
            this.diaries[userId] = [];
        }
        
        const entry = {
            id: 'entry_' + Date.now(),
            text,
            date: new Date().toISOString()
        };
        
        this.diaries[userId].unshift(entry);
        this.saveData('diaries', this.diaries);
        
        return { success: true, entry };
    }

    async localGetDiaryEntries(userId) {
        return this.diaries[userId] || [];
    }

    async localAddWord(userId, wordData) {
        if (!this.vocabularies[userId]) {
            this.vocabularies[userId] = [];
        }
        
        const word = {
            id: 'word_' + Date.now(),
            ...wordData,
            correctCount: 0,
            incorrectCount: 0,
            category: null,
            addedAt: new Date().toISOString()
        };
        
        this.vocabularies[userId].push(word);
        this.saveData('vocabularies', this.vocabularies);
        
        return { success: true, word };
    }

    async localGetWords(userId) {
        return this.vocabularies[userId] || [];
    }

    async localDeleteWord(userId, wordId) {
        if (this.vocabularies[userId]) {
            this.vocabularies[userId] = this.vocabularies[userId].filter(
                w => w.id !== wordId
            );
            this.saveData('vocabularies', this.vocabularies);
        }
        return { success: true };
    }

    async localUpdateWord(userId, wordId, wordData) {
        if (this.vocabularies[userId]) {
            const word = this.vocabularies[userId].find(w => w.id === wordId);
            if (word) {
                Object.assign(word, wordData);
                this.saveData('vocabularies', this.vocabularies);
            }
        }
        return { success: true };
    }

    async localUpdateWordStats(userId, wordId, isCorrect) {
        if (this.vocabularies[userId]) {
            const word = this.vocabularies[userId].find(w => w.id === wordId);
            if (word) {
                if (isCorrect) {
                    word.correctCount = (word.correctCount || 0) + 1;
                } else {
                    word.incorrectCount = (word.incorrectCount || 0) + 1;
                }
                this.saveData('vocabularies', this.vocabularies);
            }
        }
        return { success: true };
    }

    async localUpdateWordCategory(userId, wordId, category) {
        if (this.vocabularies[userId]) {
            const word = this.vocabularies[userId].find(w => w.id === wordId);
            if (word) {
                word.category = category;
                this.saveData('vocabularies', this.vocabularies);
            }
        }
        return { success: true };
    }

    async localUpdateDiaryEntry(userId, entryId, text) {
        if (this.diaries[userId]) {
            const entry = this.diaries[userId].find(e => e.id === entryId);
            if (entry) {
                entry.text = text;
                this.saveData('diaries', this.diaries);
            }
        }
        return { success: true };
    }

    async localDeleteDiaryEntry(userId, entryId) {
        if (this.diaries[userId]) {
            this.diaries[userId] = this.diaries[userId].filter(
                e => e.id !== entryId
            );
            this.saveData('diaries', this.diaries);
        }
        return { success: true };
    }

    async localSaveBoard(boardId, elements) {
        if (!this.boards) this.boards = this.loadData('boards') || {};
        this.boards[boardId] = { elements, updatedAt: new Date().toISOString() };
        this.saveData('boards', this.boards);
        return { success: true };
    }

    async localGetBoard(boardId) {
        if (!this.boards) this.boards = this.loadData('boards') || {};
        const board = this.boards[boardId];
        return board ? board.elements : [];
    }

    async localGetStudentStats(studentId) {
        const diaryCount = (this.diaries[studentId] || []).length;
        const wordsCount = (this.vocabularies[studentId] || []).length;
        
        return {
            diaryEntries: diaryCount,
            wordsCount: wordsCount
        };
    }

    // =============== ПУБЛИЧНЫЕ МЕТОДЫ (автоматически выбирают Firebase или Local) ===============

    async login(login, password) {
        return this.useFirebase 
            ? await this.firebaseLogin(login, password)
            : await this.localLogin(login, password);
    }

    async registerTeacher(teacherData) {
        return this.useFirebase
            ? await this.firebaseRegisterTeacher(teacherData)
            : await this.localRegisterTeacher(teacherData);
    }

    async addStudent(studentData, teacherId) {
        return this.useFirebase
            ? await this.firebaseAddStudent(studentData, teacherId)
            : await this.localAddStudent(studentData, teacherId);
    }

    async getStudents(teacherId) {
        return this.useFirebase
            ? await this.firebaseGetStudents(teacherId)
            : await this.localGetStudents(teacherId);
    }

    async deleteStudent(studentId) {
        return this.useFirebase
            ? await this.firebaseDeleteStudent(studentId)
            : await this.localDeleteStudent(studentId);
    }

    async addDiaryEntry(userId, text) {
        return this.useFirebase
            ? await this.firebaseAddDiaryEntry(userId, text)
            : await this.localAddDiaryEntry(userId, text);
    }

    async getDiaryEntries(userId) {
        return this.useFirebase
            ? await this.firebaseGetDiaryEntries(userId)
            : await this.localGetDiaryEntries(userId);
    }

    async addWord(userId, wordData) {
        return this.useFirebase
            ? await this.firebaseAddWord(userId, wordData)
            : await this.localAddWord(userId, wordData);
    }

    async getWords(userId) {
        return this.useFirebase
            ? await this.firebaseGetWords(userId)
            : await this.localGetWords(userId);
    }

    async deleteWord(userId, wordId) {
        return this.useFirebase
            ? await this.firebaseDeleteWord(userId, wordId)
            : await this.localDeleteWord(userId, wordId);
    }

    async updateWord(userId, wordId, wordData) {
        return this.useFirebase
            ? await this.firebaseUpdateWord(userId, wordId, wordData)
            : await this.localUpdateWord(userId, wordId, wordData);
    }

    async updateDiaryEntry(userId, entryId, text) {
        return this.useFirebase
            ? await this.firebaseUpdateDiaryEntry(userId, entryId, text)
            : await this.localUpdateDiaryEntry(userId, entryId, text);
    }

    async deleteDiaryEntry(userId, entryId) {
        return this.useFirebase
            ? await this.firebaseDeleteDiaryEntry(userId, entryId)
            : await this.localDeleteDiaryEntry(userId, entryId);
    }

    async getStudentStats(studentId) {
        return this.useFirebase
            ? await this.firebaseGetStudentStats(studentId)
            : await this.localGetStudentStats(studentId);
    }

    async updateWordStats(userId, wordId, isCorrect) {
        return this.useFirebase
            ? await this.firebaseUpdateWordStats(userId, wordId, isCorrect)
            : await this.localUpdateWordStats(userId, wordId, isCorrect);
    }

    async updateWordCategory(userId, wordId, category) {
        return this.useFirebase
            ? await this.firebaseUpdateWordCategory(userId, wordId, category)
            : await this.localUpdateWordCategory(userId, wordId, category);
    }

    async saveBoard(boardId, elements) {
        return this.useFirebase
            ? await this.firebaseSaveBoard(boardId, elements)
            : await this.localSaveBoard(boardId, elements);
    }

    async getBoard(boardId) {
        return this.useFirebase
            ? await this.firebaseGetBoard(boardId)
            : await this.localGetBoard(boardId);
    }
}

// Экспорт
export const db = new Database();
