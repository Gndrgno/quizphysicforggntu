// Импорт основных модулей SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Модули базы данных (Firestore)
import { 
    getFirestore, 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    setDoc,
    updateDoc, 
    deleteDoc, 
    serverTimestamp,
    orderBy,
    query,
    where 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Модуль аутентификации (Auth)
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Модуль хранилища файлов (Storage - для загрузки фото к вопросам)
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Конфигурация твоего приложения
const firebaseConfig = {
    apiKey: "AIzaSyB01M6sE4fsJ5ejlVtDqxYVFdMCpPsOmV8",
    authDomain: "quizforggntu.firebaseapp.com",
    projectId: "quizforggntu",
    storageBucket: "quizforggntu.firebasestorage.app",
    messagingSenderId: "308445389692",
    appId: "1:308445389692:web:c228457d184b5fb1d9faf9",
    measurementId: "G-KBVD5JB30D"
};

// Инициализация сервисов
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Экспорт в глобальную область видимости window для доступа из других скриптов
window.db = db;
window.auth = auth;
window.storage = storage;

// Группируем полезные функции Firestore для удобства
window.fb = {
    collection,
    addDoc,
    getDocs,
    doc,
    setDoc, // Обязательно добавь это здесь
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    serverTimestamp,    
    orderBy,
    storageRef: ref,
    uploadBytes,
    getDownloadURL,
    onAuthStateChanged,
    signOut
};

console.log("Firebase успешно инициализирован: Firestore, Auth, Storage.");