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

    async firebaseAddStudent(studentData) {
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
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await newStudentRef.set(userData);
        await database.ref(`students/${id}`).set({
            id,
            name: studentData.name,
            login: studentData.login,
            language: studentData.language,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        
        return { success: true, studentId: id };
    }

    async firebaseGetStudents() {
        const snapshot = await database.ref('students').once('value');
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

    async localAddStudent(studentData) {
        const id = 'student_' + Date.now();
        this.users[id] = {
            id,
            ...studentData,
            role: 'student'
        };
        this.students[id] = {
            id,
            name: studentData.name,
            login: studentData.login,
            language: studentData.language,
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

    async localGetStudents() {
        return Object.values(this.students);
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

    async addStudent(studentData) {
        return this.useFirebase
            ? await this.firebaseAddStudent(studentData)
            : await this.localAddStudent(studentData);
    }

    async getStudents() {
        return this.useFirebase
            ? await this.firebaseGetStudents()
            : await this.localGetStudents();
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

    async getStudentStats(studentId) {
        return this.useFirebase
            ? await this.firebaseGetStudentStats(studentId)
            : await this.localGetStudentStats(studentId);
    }
}

// Экспорт
export const db = new Database();
