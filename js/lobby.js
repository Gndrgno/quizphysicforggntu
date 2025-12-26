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
        stopBtn: document.getElementById('stopGame'),
        readyBtn: document.getElementById('readyBtn'),
        statusText: document.getElementById('statusText'),
        accessCard: document.querySelector('.access-card')
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = sessionStorage.getItem('myPlayerId');
    let isHost = false;

    // --- УПРАВЛЕНИЕ МОДАЛЬНЫМ ОКНОМ (идентично стилю из drafts.js) ---
    function showConfirmModal(title, message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-title">${title}</div>
                <div class="modal-text">${message}</div>
                <div class="modal-buttons">
                    <button class="btn-confirm">Да</button>
                    <button class="btn-cancel">Отмена</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        setTimeout(() => overlay.classList.add('active'), 10);

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.querySelector('.btn-confirm').onclick = () => { onConfirm(); close(); };
        overlay.querySelector('.btn-cancel').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    async function initLobby() {
        const activeQuizId = sessionStorage.getItem('activeQuizId');

        if (activeQuizId) {
            isHost = true;
            nodes.adminControls.style.display = 'block';
            nodes.playerControls.style.display = 'none';
            nodes.accessCard.style.display = 'block';
            await setupAdminSession(activeQuizId);
        } else {
            isHost = false;
            nodes.playerControls.style.display = 'block';
            nodes.adminControls.style.display = 'none';
            nodes.accessCard.style.display = 'none';

            const urlParams = new URLSearchParams(window.location.search);
            const codeFromUrl = urlParams.get('code');
            
            if (codeFromUrl) {
                currentLobbyCode = codeFromUrl;
                sessionStorage.setItem('currentLobbyCode', currentLobbyCode);
            }

            if (!currentLobbyCode) {
                alert("Код комнаты не найден. Вернитесь на главную.");
                window.location.href = 'homepage.html';
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

            // Кнопка "Покинуть лобби" с отступом
            const leaveBtn = document.createElement('button');
            leaveBtn.className = 'btn btn-leave';
            leaveBtn.style.marginTop = '10px'; // Отступ от кнопки "Я готов!"
            leaveBtn.textContent = 'Покинуть лобби';
            leaveBtn.onclick = () => {
                showConfirmModal('Покинуть лобби', 'Вы уверены, что хотите покинуть лобби?', async () => {
                    await deleteDoc(doc(db, 'active_sessions', code, 'players', myPlayerId));
                    sessionStorage.removeItem('myPlayerId');
                    sessionStorage.removeItem('currentLobbyCode');
                    window.location.href = 'homepage.html';
                });
            };
            nodes.playerControls.appendChild(leaveBtn);

            // Отслеживание выхода (не гарантировано, но оставляем)
            window.onbeforeunload = async () => {
                navigator.sendBeacon('/dummy', '');
                await deleteDoc(doc(db, 'active_sessions', code, 'players', myPlayerId));
            };

            listenToLobby(code);
        } catch (err) {
            console.error("Ошибка в setupPlayerSession:", err);
        }
    }

    function listenToLobby(code) {
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
                nodes.startBtn.textContent = `Начать (${readyCount} готовы)`;
            }
        });

        onSnapshot(doc(db, 'active_sessions', code), (snap) => {
            if (!snap.exists()) {
                alert("Сессия завершена администратором.");
                sessionStorage.removeItem('currentLobbyCode');
                sessionStorage.removeItem('myPlayerId');
                sessionStorage.removeItem('activeQuizId');
                window.location.href = 'homepage.html';
                return;
            }

            const data = snap.data();
            if (data.status === 'playing') {
                sessionStorage.setItem('currentLobbyCode', code);
                window.location.href = 'game_process.html';
            }

            nodes.statusText.textContent = data.status === 'waiting' ? 'Ожидание игроков' : 'Игра начата';
        });
    }

    function updateAccessUI(code) {
        nodes.displayCode.textContent = code.match(/.{1,4}/g).join(' ');
        const url = `${window.location.origin}/quizphysicforggntu/lobby.html?code=${code}`;
        nodes.quizLink.value = url;
        // Улучшенный QR-код: больший размер, высокая коррекция ошибок
        nodes.qrImage.src = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=${encodeURIComponent(url)}&choe=UTF-8&chld=H|1`;
    }

    // Кнопки
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
        nodes.stopBtn.onclick = () => {
            showConfirmModal('Завершить сессию', 'Завершить сессию? Все игроки будут отключены.', async () => {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode));
                sessionStorage.removeItem('currentLobbyCode');
                sessionStorage.removeItem('activeQuizId');
                window.location.href = 'homepage.html';
            });
        };
    }

    initLobby();
};

document.addEventListener('DOMContentLoaded', startLobby);

function copyLink() {
    const linkInput = document.getElementById('quizLink');
    linkInput.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}