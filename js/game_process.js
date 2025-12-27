// Функция для поиска Firebase в глобальной области
const getFirebaseConfig = () => {
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    if (fb && db) return { fb, db };
    return null;
};

const startGame = async () => {
    const config = getFirebaseConfig();
    if (!config) {
        console.warn("Firebase ожидание...");
        setTimeout(startGame, 500);
        return;
    }

    const { fb, db } = config;
    const { 
        collection, doc, getDoc, setDoc, updateDoc, 
        onSnapshot, deleteDoc, serverTimestamp, getDocs, arrayUnion 
    } = fb;

    const nodes = {
        quizTitleAdmin: document.getElementById('quizTitleAdmin'),
        questionTextAdmin: document.getElementById('questionTextAdmin'),
        timerAdmin: document.getElementById('timerAdmin'),
        playersAnswersList: document.getElementById('playersAnswersList'),
        nextQuestionBtn: document.getElementById('nextQuestionBtn'),
        endGameBtn: document.getElementById('endGameBtn'),
        quizTitlePlayer: document.getElementById('quizTitlePlayer'),
        questionTextPlayer: document.getElementById('questionTextPlayer'),
        timerPlayer: document.getElementById('timerPlayer'),
        answersList: document.getElementById('answersList'),
        playerScore: document.getElementById('playerScore'),
        adminGameControls: document.getElementById('adminGameControls'),
        playerGameControls: document.getElementById('playerGameControls')
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = localStorage.getItem('myPlayerId');
    let isHost = false;
    let quizData = null;
    let currentQuestionIndex = 0;
    let timerInterval = null;
    let timeLeft = 10; // Время на вопрос (секунды)
    let halfTime = timeLeft / 2; // Половина времени для двойных баллов
    let playerScores = {}; // Локальный кеш баллов игроков

    // --- ДИНАМИЧЕСКОЕ МОДАЛЬНОЕ ОКНО (единый стиль проекта, как в lobby) ---
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

    // --- ДИНАМИЧЕСКОЕ УВЕДОМЛЕНИЕ (toast, как в lobby) ---
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

    // --- ИНИЦИАЛИЗАЦИЯ ИГРЫ ---
    async function initGame() {
        const sessionSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
        if (!sessionSnap.exists()) {
            window.location.href = 'homepage.html';
            return;
        }

        const sessionData = sessionSnap.data();
        quizData = await getDoc(doc(db, 'quizzes', sessionData.quizId));
        quizData = quizData.data();

        isHost = !!sessionStorage.getItem('activeQuizId'); // Админ — тот, кто создал сессию

        if (isHost) {
            nodes.adminGameControls.style.display = 'block';
            nodes.playerGameControls.style.display = 'none';
            nodes.quizTitleAdmin.textContent = quizData.title;
            setupAdminControls();
        } else {
            nodes.playerGameControls.style.display = 'block';
            nodes.adminGameControls.style.display = 'none';
            nodes.quizTitlePlayer.textContent = quizData.title;
            nodes.playerScore.textContent = 'Ваш счёт: 0';
            setupPlayerControls();
        }

        listenToGameState();
        startQuestion(0);
    }

    // --- НАСТРОЙКА ДЛЯ АДМИНА (список ответов игроков, кнопки следующий/завершить) ---
    function setupAdminControls() {
        nodes.nextQuestionBtn.onclick = () => {
            currentQuestionIndex++;
            if (currentQuestionIndex < quizData.questions.length) {
                startQuestion(currentQuestionIndex);
            } else {
                endGame();
            }
        };

        nodes.endGameBtn.onclick = () => {
            showConfirmModal('Завершить игру', 'Вы уверены, что хотите завершить игру?', async () => {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode));
                sessionStorage.clear();
                window.location.href = 'homepage.html';
            });
        };
    }

    // --- НАСТРОЙКА ДЛЯ ИГРОКА (варианты ответов, клик на ответ) ---
    function setupPlayerControls() {
        // Логика клика на ответ будет в renderQuestionForPlayer
    }

    // --- ПРОСЛУШИВАНИЕ СОСТОЯНИЯ ИГРЫ (onSnapshot для обновлений) ---
    function listenToGameState() {
        onSnapshot(doc(db, 'active_sessions', currentLobbyCode), (snap) => {
            if (!snap.exists()) {
                if (!isHost) {
                    showToast("Игра завершена администратором.");
                    localStorage.removeItem('myPlayerId');
                    sessionStorage.clear();
                    setTimeout(() => window.close(), 1500);
                }
                return;
            }
            const data = snap.data();
            if (data.status !== 'playing') {
                window.location.href = 'lobby.html';
            }
        });

        // Прослушка ответов игроков (для админа)
        if (isHost) {
            onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snapshot) => {
                nodes.playersAnswersList.innerHTML = '';
                snapshot.forEach((answerDoc) => {
                    const answerData = answerDoc.data();
                    const div = document.createElement('div');
                    div.className = 'player-answer-tag fade-in';
                    div.innerHTML = `
                        <span>${answerData.playerName}</span>
                        <span class="answer-status">${answerData.answerIndex === quizData.questions[currentQuestionIndex].correctAnswerIndex ? 'Правильно' : 'Неправильно'}</span>
                        <span class="score">+${answerData.points} баллов</span>
                    `;
                    nodes.playersAnswersList.appendChild(div);
                });
            });
        }
    }

    // --- СТАРТ НОВОГО ВОПРОСА (таймер, рендер вопроса) ---
    async function startQuestion(index) {
        const question = quizData.questions[index];
        timeLeft = 10;
        halfTime = timeLeft / 2;

        if (isHost) {
            nodes.questionTextAdmin.textContent = `Текущий вопрос: ${question.question}`;
            nodes.timerAdmin.textContent = `Таймер: ${timeLeft}`;
            nodes.playersAnswersList.innerHTML = ''; // Очистка ответов для нового вопроса
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                currentQuestion: index
            });
        } else {
            nodes.questionTextPlayer.textContent = question.question;
            nodes.timerPlayer.textContent = `Таймер: ${timeLeft}`;
            renderAnswersForPlayer(question.answers, index);
        }

        startTimer();
    }

    // --- ТАЙМЕР (общий для всех через JS, синхронизирован по serverTimestamp) ---
    function startTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(async () => {
            timeLeft--;
            if (isHost) {
                nodes.timerAdmin.textContent = `Таймер: ${timeLeft}`;
            } else {
                nodes.timerPlayer.textContent = `Таймер: ${timeLeft}`;
            }

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                showCorrectAnswers();
                if (isHost) {
                    nodes.nextQuestionBtn.disabled = false;
                }
            }
        }, 1000);
    }

    // --- РЕНДЕР ВАРИАНТОВ ОТВЕТОВ ДЛЯ ИГРОКА (кнопки) ---
    function renderAnswersForPlayer(answers, questionIndex) {
        nodes.answersList.innerHTML = '';
        answers.forEach((answer, idx) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn fade-in';
            btn.textContent = answer;
            btn.onclick = async () => {
                // Отправка ответа в Firebase
                await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', myPlayerId), {
                    questionIndex,
                    answerIndex: idx,
                    timeTaken: 10 - timeLeft,
                    points: calculatePoints(idx, question.correctAnswerIndex, 10 - timeLeft)
                });
                disableAnswerButtons();
                showToast('Ответ отправлен!');
            };
            nodes.answersList.appendChild(btn);
        });
    }

    // --- РАСЧЁТ БАЛЛОВ (1 за правильный, 2 за быстрый правильный) ---
    function calculatePoints(selectedIndex, correctIndex, timeTaken) {
        if (selectedIndex !== correctIndex) return 0;
        return timeTaken <= halfTime ? 2 : 1;
    }

    // --- ПОКАЗ ПРАВИЛЬНЫХ/НЕПРАВИЛЬНЫХ ОТВЕТОВ (зелёный/красный) ---
    function showCorrectAnswers() {
        const buttons = nodes.answersList.querySelectorAll('.answer-btn');
        buttons.forEach((btn, idx) => {
            if (idx === quizData.questions[currentQuestionIndex].correctAnswerIndex) {
                btn.classList.add('correct');
            } else {
                btn.classList.add('incorrect');
            }
        });
    }

    // --- ОТКЛЮЧЕНИЕ КНОПОК ПОСЛЕ ОТВЕТА (для игрока) ---
    function disableAnswerButtons() {
        const buttons = nodes.answersList.querySelectorAll('.answer-btn');
        buttons.forEach(btn => btn.disabled = true);
    }

    // --- ЗАВЕРШЕНИЕ ИГРЫ (показ финальных баллов у админа) ---
    async function endGame() {
        clearInterval(timerInterval);
        showToast('Игра завершена!');
        if (isHost) {
            nodes.questionTextAdmin.textContent = 'Игра завершена!';
            nodes.timerAdmin.textContent = '';
            nodes.nextQuestionBtn.disabled = true;
            // Финальные баллы можно показать в списке игроков
        } else {
            nodes.questionTextPlayer.textContent = 'Игра завершена!';
            nodes.timerPlayer.textContent = '';
        }
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
    }

    initGame();
};

document.addEventListener('DOMContentLoaded', startGame);