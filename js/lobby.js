// Функция для поиска Firebase в глобальной области
const getFirebaseConfig = () => {
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    if (fb && db) return { fb, db };
    return null;
};

const startLobby = async () => {
    const config = getFirebaseConfig();
    if (!config) {
        console.warn("Firebase ожидание...");
        setTimeout(startLobby, 500);
        return;
    }

    const { fb, db } = config;
    const { 
        collection, doc, getDoc, setDoc, updateDoc, 
        onSnapshot, deleteDoc, serverTimestamp, getDocs 
    } = fb;

    const nodes = {
        quizTitle: document.getElementById('quizTitle'),
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
    let myPlayerId = localStorage.getItem('myPlayerId');
    let isHost = false;

    // --- ДИНАМИЧЕСКОЕ МОДАЛЬНОЕ ОКНО (единый стиль проекта) ---
    function showConfirmModal(title, message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6); display: flex; justify-content: center; align-items: center;
            z-index: 10000; opacity: 0; transition: all 0.3s ease; backdrop-filter: blur(4px);
        `;
        overlay.innerHTML = `
            <div style="background: #fff; width: 320px; border-radius: 16px; padding: 24px; text-align: center; transform: scale(0.8); transition: all 0.3s ease; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <div style="color: #1a1a1a; font-size: 20px; font-weight: 700; margin-bottom: 12px; font-family: sans-serif;">${title}</div>
                <div style="color: #666; font-size: 15px; line-height: 1.5; margin-bottom: 24px; font-family: sans-serif;">${message}</div>
                <div style="display: flex; gap: 12px;">
                    <button id="modal-cancel" style="flex: 1; padding: 12px; border-radius: 12px; border: 1px solid #e0e0e0; background: #f5f5f5; color: #333; font-weight: 600; cursor: pointer;">Отмена</button>
                    <button id="modal-confirm" style="flex: 1; padding: 12px; border-radius: 12px; border: none; background: #8a2be2; color: #fff; font-weight: 600; cursor: pointer;">Подтвердить</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        const content = overlay.firstElementChild;

        setTimeout(() => {
            overlay.style.opacity = '1';
            content.style.transform = 'scale(1)';
        }, 10);

        const close = () => {
            overlay.style.opacity = '0';
            content.style.transform = 'scale(0.8)';
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.querySelector('#modal-confirm').onclick = () => { onConfirm(); close(); };
        overlay.querySelector('#modal-cancel').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    // --- ДИНАМИЧЕСКОЕ УВЕДОМЛЕНИЕ (toast) ---
    function showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: #333; color: #fff; padding: 12px 24px; border-radius: 50px;
            font-size: 14px; z-index: 10001; opacity: 0; transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // --- КОПИРОВАНИЕ ССЫЛКИ С ТОАСТОМ ---
    window.copyLink = () => {
        const linkInput = document.getElementById('quizLink');
        linkInput.select();
        linkInput.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(linkInput.value);
        showToast("Ссылка скопирована!");
    };

    // --- ИНИЦИАЛИЗАЦИЯ ЛОББИ ---
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
                window.location.href = 'homepage.html';
                return;
            }
            await setupPlayerSession(currentLobbyCode);
        }
        if (nodes.globalLoader) nodes.globalLoader.classList.remove('active');
    }

    async function setupAdminSession(quizId) {
        try {
            const quizSnap = await getDoc(doc(db, 'quizzes', quizId));
            if (!quizSnap.exists()) return;

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
        } catch (err) { console.error(err); }
    }

    // --- УДАЛЕНИЕ ИГРОКА ИЗ БАЗЫ ТОЛЬКО ПРИ ЯВНОМ ВЫХОДЕ (кнопка "Покинуть") ---
    async function permanentlyRemovePlayer() {
        if (myPlayerId && currentLobbyCode && !isHost) {
            try {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
            } catch (err) {
                console.error("Ошибка полного удаления игрока:", err);
            }
        }
        localStorage.removeItem('myPlayerId');
        sessionStorage.clear();
    }

    async function setupPlayerSession(code) {
        try {
            const sessionSnap = await getDoc(doc(db, 'active_sessions', code));
            if (!sessionSnap.exists()) {
                localStorage.removeItem('myPlayerId');
                sessionStorage.clear();
                window.location.href = 'homepage.html';
                return;
            }

            const data = sessionSnap.data();
            nodes.quizTitle.textContent = data.title;
            nodes.totalQuestions.textContent = data.questionsCount;

            let playerName = null;
            let playerWasReady = false;

            if (myPlayerId) {
                const existingPlayerDoc = await getDoc(doc(db, 'active_sessions', code, 'players', myPlayerId));
                if (existingPlayerDoc.exists()) {
                    const playerData = existingPlayerDoc.data();
                    playerName = playerData.name;
                    playerWasReady = playerData.isReady || false;

                    await updateDoc(doc(db, 'active_sessions', code, 'players', myPlayerId), {
                        joinedAt: serverTimestamp()
                    });

                    showToast(`Добро пожаловать обратно, ${playerName}!`);
                } else {
                    localStorage.removeItem('myPlayerId');
                    myPlayerId = null;
                }
            }

            if (!myPlayerId || !playerName) {
                myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('myPlayerId', myPlayerId);

                const pSnap = await getDocs(collection(db, 'active_sessions', code, 'players'));
                const existingPlayer = [...pSnap.docs].find(d => d.id === myPlayerId);

                if (existingPlayer) {
                    showConfirmModal('Ошибка подключения', 'Вы уже подключены к этой комнате в другой вкладке.', () => {
                        window.close();
                    });
                    return;
                }

                const newPlayerNum = pSnap.size + 1;
                playerName = `Игрок ${newPlayerNum}`;

                await setDoc(doc(db, 'active_sessions', code, 'players', myPlayerId), {
                    name: playerName,
                    isReady: false,
                    joinedAt: serverTimestamp()
                });
            }

            if (playerWasReady && nodes.readyBtn) {
                nodes.readyBtn.classList.add('active');
                nodes.readyBtn.textContent = "Готов!";
            }

            // === БЛОК СМЕНЫ ИМЕНИ: полностью адаптивный, без фиксированных ширин, кнопка никогда не вылетает ===
            if (!document.querySelector('.name-change-container')) {
                const nameContainer = document.createElement('div');
nameContainer.className = 'name-change-container';

const nameInput = document.createElement('input');
nameInput.type = 'text';
nameInput.placeholder = 'Ваше имя';
nameInput.value = playerName;

const changeNameBtn = document.createElement('button');
changeNameBtn.textContent = 'Изменить';
// ... onclick остаётся

nameContainer.appendChild(nameInput);
nameContainer.appendChild(changeNameBtn);

nodes.playerControls.insertBefore(nameContainer, nodes.readyBtn);
            }

            // Кнопка "Покинуть лобби"
            if (!document.querySelector('.btn-leave')) {
                const leaveBtn = document.createElement('button');
                leaveBtn.className = 'btn btn-leave';
                leaveBtn.style.cssText = 'margin-top: 12px; background: #ff4757; color: white; border: none; padding: 12px; border-radius: 12px; width: 100%; font-weight: 600; cursor: pointer;';
                leaveBtn.textContent = 'Покинуть лобби';
                leaveBtn.onclick = () => {
                    showConfirmModal('Выход', 'Вы уверены, что хотите покинуть комнату навсегда?', async () => {
                        await permanentlyRemovePlayer();
                        window.close();
                    });
                };
                nodes.playerControls.appendChild(leaveBtn);
            }

            listenToLobby(code);
        } catch (err) { 
            console.error(err);
            localStorage.removeItem('myPlayerId');
            sessionStorage.clear();
            window.location.href = 'homepage.html';
        }
    }

    function listenToLobby(code) {
        let previousPlayers = new Map();

        onSnapshot(collection(db, 'active_sessions', code, 'players'), (snapshot) => {
            const currentPlayers = new Map();
            let readyCount = 0;

            snapshot.forEach((pDoc) => {
                const p = pDoc.data();
                currentPlayers.set(pDoc.id, p);
                if (p.isReady) readyCount++;
            });

            const added = [];
            const updated = [];
            const removed = [];

            currentPlayers.forEach((p, id) => {
                if (!previousPlayers.has(id)) {
                    added.push({ id, p });
                } else {
                    const prev = previousPlayers.get(id);
                    if (prev.name !== p.name || prev.isReady !== p.isReady) {
                        updated.push({ id, p });
                    }
                }
            });

            previousPlayers.forEach((p, id) => {
                if (!currentPlayers.has(id)) removed.push(id);
            });

            // Удаление с анимацией
            removed.forEach(id => {
                const playerTag = document.getElementById(`player-${id}`);
                if (playerTag) {
                    playerTag.style.opacity = '0';
                    playerTag.style.transform = 'translateY(10px)';
                    playerTag.style.transition = 'all 0.3s ease';
                    setTimeout(() => playerTag.remove(), 300);
                }
            });

            // Добавление новых
            added.forEach(({ id, p }) => {
                const div = document.createElement('div');
                div.id = `player-${id}`;
                div.className = 'player-tag';
                div.style.cssText = `
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    width: 100%; 
                    padding: 14px 16px; 
                    background: #f8f9fa; 
                    border-radius: 14px; 
                    margin-bottom: 10px;
                    min-height: 60px;
                    box-sizing: border-box;
                    opacity: 0;
                    transform: translateY(10px);
                    transition: all 0.3s ease;
                `;

                const nameSpan = document.createElement('span');
                nameSpan.textContent = p.name;
                nameSpan.style.cssText = 'font-size: 16px; font-weight: 500; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;';

                const statusDot = document.createElement('div');
                statusDot.className = 'ready-status';
                statusDot.style.cssText = `
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: ${p.isReady ? '#28a745' : '#dc3545'};
                    flex-shrink: 0;
                    box-shadow: 0 0 8px ${p.isReady ? '#28a745' : '#dc3545'};
                    transition: background 0.4s ease, box-shadow 0.4s ease;
                `;

                div.appendChild(nameSpan);
                div.appendChild(statusDot);
                nodes.playersList.appendChild(div);

                setTimeout(() => {
                    div.style.opacity = '1';
                    div.style.transform = 'translateY(0)';
                }, 50);
            });

            // Обновление существующих игроков (имя или статус)
            updated.forEach(({ id, p }) => {
                const playerTag = document.getElementById(`player-${id}`);
                if (playerTag) {
                    const nameSpan = playerTag.querySelector('span');
                    if (nameSpan && nameSpan.textContent !== p.name) {
                        nameSpan.textContent = p.name;
                    }
                    const statusDot = playerTag.querySelector('.ready-status');
                    if (statusDot) {
                        statusDot.style.background = p.isReady ? '#28a745' : '#dc3545';
                        statusDot.style.boxShadow = `0 0 8px ${p.isReady ? '#28a745' : '#dc3545'}`;
                    }
                }
            });

            nodes.playersCount.textContent = snapshot.size;
            if (isHost) {
                const canStart = (readyCount === snapshot.size && snapshot.size > 0);
                nodes.startBtn.disabled = !canStart;
                nodes.startBtn.textContent = `Начать (${readyCount} готовы)`;
            }

            previousPlayers = currentPlayers;
        });

        onSnapshot(doc(db, 'active_sessions', code), (snap) => {
            if (!snap.exists()) {
                if (!isHost) {
                    showToast("Сессия завершена администратором.");
                    localStorage.removeItem('myPlayerId');
                    sessionStorage.clear();
                    setTimeout(() => window.close(), 1500);
                }
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

        const finalUrl = `https://gndrgno.github.io/quizphysicforggntu/lobby.html?code=${code}`;

        nodes.quizLink.value = finalUrl;

        nodes.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(finalUrl)}&margin=20&ecc=H`;

        nodes.qrImage.onerror = () => {
            nodes.qrImage.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjUwIiBoZWlnaHQ9IjI1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTBkZWZmIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjODAyYmU4Ij5RUkVycm9yPC90ZXh0Pjwvc3ZnPg==';
            nodes.qrImage.alt = "Ошибка загрузки QR-кода";
        };

        nodes.qrImage.style.cursor = 'pointer';
        nodes.qrImage.onclick = () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.85); display: flex; justify-content: center; align-items: center;
                z-index: 10000; opacity: 0; transition: opacity 0.4s ease;
                backdrop-filter: blur(12px);
            `;

            const enlargedImg = document.createElement('img');
            enlargedImg.src = nodes.qrImage.src;
            enlargedImg.style.cssText = `
                max-width: 90vw; max-height: 90vh; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                opacity: 0; transform: scale(0.8); transition: all 0.4s ease;
            `;

            overlay.appendChild(enlargedImg);
            document.body.appendChild(overlay);

            setTimeout(() => {
                overlay.style.opacity = '1';
                enlargedImg.style.opacity = '1';
                enlargedImg.style.transform = 'scale(1)';
            }, 10);

            overlay.onclick = () => {
                overlay.style.opacity = '0';
                enlargedImg.style.opacity = '0';
                enlargedImg.style.transform = 'scale(0.8)';
                setTimeout(() => overlay.remove(), 400);
            };
        };
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
            showConfirmModal('Завершить сессию', 'Вы уверены? Все игроки будут отключены от игры.', async () => {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode));
                sessionStorage.clear();
                window.location.href = 'homepage.html';
            });
        };
    }

    initLobby();
};

document.addEventListener('DOMContentLoaded', startLobby);