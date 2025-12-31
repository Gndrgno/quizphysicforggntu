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
    getDoc,
    updateDoc, 
    deleteDoc, 
    serverTimestamp,
    orderBy,
    query,
    where,
    onSnapshot,
    increment // <- добавил increment
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

try {
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
        getDoc,
        doc,
        setDoc,
        updateDoc, 
        deleteDoc, 
        query, 
        where, 
        serverTimestamp,
        orderBy,
        onSnapshot,
        increment,      // <- атомарный increment
        storageRef: ref,
        uploadBytes,
        getDownloadURL,
        onAuthStateChanged,
        signOut
    };

    // Флаг и событие — чтобы другие скрипты могли быстро отреагировать
    window.__FIREBASE_READY__ = true;
    window.dispatchEvent(new Event('firebase-ready'));

    console.log("Firebase успешно инициализирован: Firestore, Auth, Storage.");
} catch (err) {
    console.error("Ошибка инициализации Firebase configure.js:", err);
    // всё равно выставим флаг false и пошлём событие с ошибкой
    window.__FIREBASE_READY__ = false;
    window.dispatchEvent(new CustomEvent('firebase-ready', { detail: { error: err } }));
}