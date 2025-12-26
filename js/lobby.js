// Функция для поиска Firebase в глобальной области (без изменений)
const getFirebaseConfig = () => {
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    
    if (fb && db) return { fb, db };
    return null;
};

const startLobby = async () => {
    const config = getFirebaseConfig();

    if (!config) {
        console.warn("Firebase (window.fb/window.db) не обнаружен. Ожидание...");
        setTimeout(startLobby, 500);
        return;
    }

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
        stopBtn: document.getElementById('stopGame'),  // Добавили ноду для stop
        readyBtn: document.getElementById('readyBtn'),
        statusText: document.getElementById('statusText'),
        accessCard: document.querySelector('.access-card')  // Добавили для скрытия
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = sessionStorage.getItem('myPlayerId');
    let isHost = false;

    async function initLobby() {
        const activeQuizId = sessionStorage.getItem('activeQuizId');

        if (activeQuizId) {
            isHost = true;
            nodes.adminControls.style.display = 'block';
            nodes.playerControls.style.display = 'none';
            nodes.accessCard.style.display = 'block';  // Показываем access для хоста
            await setupAdminSession(activeQuizId);
        } else {
            isHost = false;
            nodes.playerControls.style.display = 'block';
            nodes.adminControls.style.display = 'none';
            nodes.accessCard.style.display = 'none';  // Скрываем access для игроков

            const urlParams = new URLSearchParams(window.location.search);
            const codeFromUrl = urlParams.get('code');
            
            if (codeFromUrl) {
                currentLobbyCode = codeFromUrl;
                sessionStorage.setItem('currentLobbyCode', currentLobbyCode);
            }

            if (!currentLobbyCode) {
                alert("Код комнаты не найден. Вернитесь на главную.");
                window.location.href = 'homepage.html';  // Redirect назад, изменил на homepage
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
            nodes.quizTitle.textContent = quizData.title || "Без названия";
            
            const qCount = quizData.questions ? quizData.questions.length : (quizData.questionsCount || 0);
            nodes.totalQuestions.textContent = qCount;

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
                window.location.href = 'homepage.html';
                return;
            }

            const sessionData = sessionSnap.data();
            nodes.quizTitle.textContent = sessionData.title;
            nodes.totalQuestions.textContent = sessionData.questionsCount;

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

            listenToLobby(code);  // Нет updateAccessUI для игроков
        } catch (err) {
            console.error("Ошибка в setupPlayerSession:", err);
        }
    }

    function listenToLobby(code) {
        // Слушаем игроков (реальное время: список, готовность, count)
        onSnapshot(collection(db, 'active_sessions', code, 'players'), (snapshot) => {
            nodes.playersList.innerHTML = '';
            let readyCount = 0;
            snapshot.forEach((pDoc) => {
                const p = pDoc.data();
                if (p.isReady) readyCount++;
                const div = document.createElement('div');
                div.className = 'player-tag';
                div.innerHTML = `<span>${p.name}</span><div class="ready-status ${p.isReady ? 'is-ready' : ''}"></div>`;
                nodes.playersList.appendChild(div);
            });
            nodes.playersCount.textContent = snapshot.size;
            
            if (isHost) {
                const canStart = (readyCount === snapshot.size && snapshot.size > 0);
                nodes.startBtn.disabled = !canStart;
                nodes.startBtn.textContent = `Начать (${readyCount} готовы)`;  // Обновляем текст
            }
        });

        // Слушаем сессию (реальное время: статус, удаление)
        onSnapshot(doc(db, 'active_sessions', code), (snap) => {
            if (!snap.exists()) {
                // Сессия удалена (админ завершил)
                alert("Сессия завершена администратором.");
                sessionStorage.removeItem('currentLobbyCode');
                sessionStorage.removeItem('myPlayerId');
                sessionStorage.removeItem('activeQuizId');
                window.location.href = 'homepage.html';
                return;
            }

            const data = snap.data();
            if (data.status === 'playing') {
                // Все redirect в игру
                sessionStorage.setItem('currentLobbyCode', code);  // Для использования в game_process
                window.location.href = 'game_process.html';
            }

            // Обновляем статус текст (опционально, если статус меняется)
            nodes.statusText.textContent = data.status === 'waiting' ? 'Ожидание игроков' : 'Игра начата';
        });
    }

    function updateAccessUI(code) {
    nodes.displayCode.textContent = code.match(/.{1,4}/g).join(' ');
    const url = `${window.location.origin}/quizphysicforggntu/lobby.html?code=${code}`;
    nodes.quizLink.value = url;
    nodes.qrImage.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodeURIComponent(url)}`;
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

    if (nodes.stopBtn) {
        nodes.stopBtn.onclick = async () => {
            if (confirm("Завершить сессию? Все игроки будут отключены.")) {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode));
                // Redirect хоста (игроки обработают через onSnapshot)
                sessionStorage.removeItem('currentLobbyCode');
                sessionStorage.removeItem('activeQuizId');
                window.location.href = 'homepage.html';
            }
        };
    }

    initLobby();
};

document.addEventListener('DOMContentLoaded', startLobby);

// Добавьте эту функцию в HTML или отдельно (для копирования ссылки, уже в вашей разметке)
function copyLink() {
    const linkInput = document.getElementById('quizLink');
    linkInput.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}