// Функция для поиска Firebase в глобальной области
const getFirebaseConfig = () => {
    // Пробуем найти под разными именами (window.fb или напрямую из window)
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    
    if (fb && db) return { fb, db };
    return null;
};

const startLobby = async () => {
    const config = getFirebaseConfig();

    if (!config) {
        console.warn("Firebase (window.fb/window.db) не обнаружен. Ожидание...");
        setTimeout(startLobby, 500); // Проверяем раз в полсекунды
        return;
    }

    // Извлекаем функции из найденного объекта
    const { fb, db } = config;
    const { 
        collection, doc, getDoc, setDoc, updateDoc, 
        onSnapshot, deleteDoc, serverTimestamp, getDocs 
    } = fb;

    console.log("✅ Firebase подключен успешно!");

    const nodes = {
        quizTitle: document.getElementById('quizTitle'),
        quizDesc: document.getElementById('quizDesc'),
        displayCode: document.getElementById('displayCode'),
        quizLink: document.getElementById('quizLink'),
        qrImage: document.getElementById('qrImage'),
        playersList: document.getElementById('playersList'),
        playersCount: document.getElementById('playersCount'),
        totalQuestions: document.getElementById('totalQuestions'),
        globalLoader: document.getElementById('globalLoader'),
        adminControls: document.getElementById('adminControls'),
        playerControls: document.getElementById('playerControls'),
        startBtn: document.getElementById('startGame'),
        readyBtn: document.getElementById('readyBtn')
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = sessionStorage.getItem('myPlayerId');
    let isHost = false;

    async function initLobby() {
        const activeQuizId = sessionStorage.getItem('activeQuizId');

        if (activeQuizId) {
            isHost = true;
            if (nodes.adminControls) nodes.adminControls.style.display = 'block';
            if (nodes.playerControls) nodes.playerControls.style.display = 'none';
            await setupAdminSession(activeQuizId);
        } else {
            isHost = false;
            if (nodes.playerControls) nodes.playerControls.style.display = 'block';
            if (nodes.adminControls) nodes.adminControls.style.display = 'none';

            const urlParams = new URLSearchParams(window.location.search);
            const codeFromUrl = urlParams.get('code');
            
            if (codeFromUrl) {
                currentLobbyCode = codeFromUrl;
                sessionStorage.setItem('currentLobbyCode', currentLobbyCode);
            }

            if (!currentLobbyCode) {
                alert("Код комнаты не найден. Вернитесь на главную.");
                window.location.href = 'index.html';
                return;
            }
            await setupPlayerSession(currentLobbyCode);
        }

        if (nodes.globalLoader) nodes.globalLoader.classList.remove('active');
    }

    async function setupAdminSession(quizId) {
        try {
            const quizRef = doc(db, 'quizzes', quizId);
            const quizSnap = await getDoc(quizRef);

            if (!quizSnap.exists()) {
                alert("Викторина не найдена!");
                return;
            }

            const quizData = quizSnap.data();
            if (nodes.quizTitle) nodes.quizTitle.textContent = quizData.title || "Без названия";
            
            const qCount = quizData.questions ? quizData.questions.length : (quizData.questionsCount || 0);
            if (nodes.totalQuestions) nodes.totalQuestions.textContent = qCount;

            if (!currentLobbyCode) {
                currentLobbyCode = Math.floor(10000000 + Math.random() * 90000000).toString();
                sessionStorage.setItem('currentLobbyCode', currentLobbyCode);

                await setDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    quizId: quizId,
                    title: quizData.title || "Без названия",
                    status: 'waiting',
                    questionsCount: qCount,
                    createdAt: serverTimestamp()
                });
            }

            updateAccessUI(currentLobbyCode);
            listenToLobby(currentLobbyCode);
        } catch (err) {
            console.error("Ошибка в setupAdminSession:", err);
        }
    }

    async function setupPlayerSession(code) {
        try {
            const sessionRef = doc(db, 'active_sessions', code);
            const sessionSnap = await getDoc(sessionRef);

            if (!sessionSnap.exists()) {
                alert("Комната не найдена.");
                window.location.href = 'index.html';
                return;
            }

            const sessionData = sessionSnap.data();
            if (nodes.quizTitle) nodes.quizTitle.textContent = sessionData.title;
            if (nodes.totalQuestions) nodes.totalQuestions.textContent = sessionData.questionsCount;

            if (!myPlayerId) {
                myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
                sessionStorage.setItem('myPlayerId', myPlayerId);

                const playersSnap = await getDocs(collection(db, 'active_sessions', code, 'players'));
                const playerNum = playersSnap.size + 1;

                await setDoc(doc(db, 'active_sessions', code, 'players', myPlayerId), {
                    name: `Игрок ${playerNum}`,
                    isReady: false,
                    joinedAt: serverTimestamp()
                });
            }

            updateAccessUI(code);
            listenToLobby(code);
        } catch (err) {
            console.error("Ошибка в setupPlayerSession:", err);
        }
    }

    function listenToLobby(code) {
        onSnapshot(collection(db, 'active_sessions', code, 'players'), (snapshot) => {
            if (nodes.playersList) nodes.playersList.innerHTML = '';
            let readyCount = 0;
            snapshot.forEach((pDoc) => {
                const p = pDoc.data();
                if (p.isReady) readyCount++;
                const div = document.createElement('div');
                div.className = 'player-tag';
                div.innerHTML = `<span>${p.name}</span><div class="ready-status ${p.isReady ? 'is-ready' : ''}"></div>`;
                nodes.playersList.appendChild(div);
            });
            if (nodes.playersCount) nodes.playersCount.textContent = snapshot.size;
            
            if (isHost && nodes.startBtn) {
                const canStart = (readyCount === snapshot.size && snapshot.size > 0);
                nodes.startBtn.disabled = !canStart;
            }
        });

        onSnapshot(doc(db, 'active_sessions', code), (snap) => {
            if (snap.exists() && snap.data().status === 'playing') {
                window.location.href = 'game_process.html';
            }
        });
    }

    function updateAccessUI(code) {
        if (nodes.displayCode) nodes.displayCode.textContent = code.match(/.{1,4}/g).join(' ');
        const url = `${window.location.origin}${window.location.pathname}?code=${code}`;
        if (nodes.quizLink) nodes.quizLink.value = url;
        if (nodes.qrImage) nodes.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
    }

    // Инициализация событий кнопок
    if (nodes.readyBtn) {
        nodes.readyBtn.onclick = async () => {
            const isReady = nodes.readyBtn.classList.toggle('active');
            nodes.readyBtn.textContent = isReady ? "Готов!" : "Я готов!";
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId), { isReady });
        };
    }

    if (nodes.startBtn) {
        nodes.startBtn.onclick = async () => {
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'playing' });
        };
    }

    initLobby();
};

document.addEventListener('DOMContentLoaded', startLobby);