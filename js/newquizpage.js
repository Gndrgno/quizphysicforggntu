document.addEventListener('DOMContentLoaded', function () {
    const wrapper = document.getElementById('questionsWrapper');
    const addQuestBtn = document.getElementById("setNewQuestion");
    const saveQuizBtn = document.querySelectorAll('#setNewQuestion')[1];
    const quizNameInput = document.getElementById('quizNameInput');

    const { collection, doc, setDoc, serverTimestamp } = window.fb;
    const db = window.db;

    /* ------------------ СТИЛИ ДЛЯ ЛОАДЕРА, УВЕДОМЛЕНИЯ И ОШИБОК ------------------ */
    const style = document.createElement('style');
    style.innerHTML = `
        .loading-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(5px);
            display: flex; justify-content: center; align-items: center;
            z-index: 9999; opacity: 0; transition: opacity 0.3s; pointer-events: none;
        }
        .loading-overlay.active { opacity: 1; pointer-events: all; }
        .spinner {
            width: 50px; height: 50px;
            border: 5px solid #f3f3f3; border-top: 5px solid #8a2be2;
            border-radius: 50%; animation: spin 1s linear infinite;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

        .toast-notification {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #8a2be2; color: white; padding: 12px 24px;
            border-radius: 8px; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000; transition: all 0.5s ease; opacity: 0;
        }
        .toast-notification.show { opacity: 1; top: 30px; }

        /* Стили валидации */
        .input-error { 
            border: 2px solid #ff4d4d !important; 
        }
        .input-error::placeholder { 
            color: #ff4d4d !important; 
        }
        #quizNameInput.input-error {
            border: none !important;
            border-bottom: 2px solid #ff4d4d !important;
        }
        
        /* Стили для ошибок радио-кнопок */
        .radio-error {
            outline: 2px solid #ff4d4d !important;
            outline-offset: 2px;
            border-radius: 50%;
        }
        .error-hint {
            color: #ff4d4d;
            font-size: 13px;
            margin-top: 5px;
            display: block;
            font-family: sans-serif;
        }
    `;
    document.head.appendChild(style);

    const loader = document.createElement('div');
    loader.className = 'loading-overlay';
    loader.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(loader);

    const redCross = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M16 8L8 16M8 8L16 16"
                  stroke-linecap="round"
                  stroke-linejoin="round"/>
        </svg>`;

    /* ------------------ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ------------------ */

    function generateQuizId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    function reindexQuestions() {
        const blocks = wrapper.querySelectorAll('.question-block');
        blocks.forEach((block, index) => {
            const newIndex = index + 1;
            block.querySelector('.nqName').textContent = `Вопрос №${newIndex}`;
            block.querySelectorAll('.nqRadio').forEach(radio => {
                radio.name = `correctAnswer_group_${newIndex}`;
            });
        });
    }

    /* ------------------ СОЗДАНИЕ ВОПРОСОВ ------------------ */

    function createQuestion() {
        const block = document.createElement('div');
        block.className = 'question-block fade-in';

        block.innerHTML = `
            <div class="question-header">
                <h2 class="nqName">Новый вопрос</h2>
                <button type="button" class="delete-btn del-q">${redCross}</button>
            </div>
            <input class="allInputsStyle baseInputs qstN" placeholder="Введите вопрос">
            <div class="ans-list"></div>
            <button type="button" class="qstBtns add-ans">Добавить вариант ответа</button>
        `;

        const ansList = block.querySelector('.ans-list');

        block.querySelector('.del-q').onclick = () => {
            const height = block.offsetHeight;
            block.style.height = height + 'px';
            setTimeout(() => block.classList.add('removing'), 10);
            setTimeout(() => {
                block.remove();
                reindexQuestions();
            }, 400);
        };

        block.querySelector('.add-ans').onclick = () => addAnswer(ansList);

        wrapper.appendChild(block);
        addAnswer(ansList);
        reindexQuestions();
    }

    function addAnswer(container) {
        const parentBlock = container.closest('.question-block');
        const qIndex = [...wrapper.children].indexOf(parentBlock) + 1;

        const row = document.createElement('div');
        row.className = 'newAnswerLine';

        row.innerHTML = `
            <input class="allInputsStyle baseInputs" placeholder="Вариант ответа">
            <button type="button" class="delete-btn del-a">${redCross}</button>
            <input type="radio" class="nqRadio" name="correctAnswer_group_${qIndex}">
        `;

        row.querySelector('.del-a').onclick = () => {
            if (container.children.length > 1) row.remove();
        };

        container.appendChild(row);
    }

    /* ------------------ СБОР ДАННЫХ И ВАЛИДАЦИЯ ------------------ */

    function collectQuizData() {
        let isValid = true;

        // Сброс предыдущих ошибок и подсказок
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
        document.querySelectorAll('.radio-error').forEach(el => el.classList.remove('radio-error'));
        document.querySelectorAll('.error-hint').forEach(el => el.remove());

        // Проверка названия викторины
        const title = quizNameInput.value.trim();
        if (!title) {
            quizNameInput.classList.add('input-error');
            isValid = false;
        }

        const questionBlocks = wrapper.querySelectorAll('.question-block');
        const questions = [];

        questionBlocks.forEach(block => {
            const qInput = block.querySelector('.qstN');
            const questionText = qInput.value.trim();
            
            if (!questionText) {
                qInput.classList.add('input-error');
                isValid = false;
            }

            const answers = [];
            let correctIndex = null;
            const answerRows = block.querySelectorAll('.newAnswerLine');

            answerRows.forEach((row, idx) => {
                const aInput = row.querySelector('input[type="text"], input:not([type])');
                const radio = row.querySelector('.nqRadio');
                const answerValue = aInput.value.trim();

                if (!answerValue) {
                    aInput.classList.add('input-error');
                    isValid = false;
                }

                answers.push(answerValue);
                if (radio.checked) correctIndex = idx;
            });

            // Проверка: выбран ли правильный ответ (radio button)
            if (correctIndex === null) {
                isValid = false;
                // Подсвечиваем все радио-кнопки в этом блоке
                block.querySelectorAll('.nqRadio').forEach(r => r.classList.add('radio-error'));
                
                // Добавляем текстовую подсказку вниз блока ответов
                const hint = document.createElement('span');
                hint.className = 'error-hint';
                hint.textContent = 'Нужно выбрать один правильный ответ';
                block.querySelector('.ans-list').after(hint);
            }

            questions.push({
                question: questionText,
                answers,
                correctAnswerIndex: correctIndex
            });
        });

        if (!isValid) {
            throw new Error("Пожалуйста, заполните все выделенные поля");
        }

        return {
            quizId: generateQuizId(),
            title,
            createdAt: serverTimestamp(),
            questionsCount: questions.length,
            questions
        };
    }

    /* ------------------ СОХРАНЕНИЕ В FIREBASE ------------------ */

    saveQuizBtn.onclick = async () => {
        try {
            const quizData = collectQuizData(); 
            
            loader.classList.add('active');

            const quizRef = doc(collection(db, 'quizzes'), quizData.title);
            await setDoc(quizRef, quizData);

            sessionStorage.setItem('quizSaved', 'true');
            window.location.href = 'homepage.html';

        } catch (err) {
            loader.classList.remove('active');
            console.error(err.message);
        }
    };

    addQuestBtn.onclick = (e) => {
        e.preventDefault();
        createQuestion();
    };

    createQuestion();
});

/* ------------------ ЛОГИКА ДЛЯ HOMEPAGE.HTML ------------------ */
if (window.location.pathname.includes('homepage.html') && sessionStorage.getItem('quizSaved')) {
    const notify = document.createElement('div');
    notify.className = 'toast-notification';
    notify.textContent = 'Викторина сохранена';
    document.body.appendChild(notify);
    
    setTimeout(() => notify.classList.add('show'), 100);
    
    setTimeout(() => {
        notify.classList.remove('show');
        sessionStorage.removeItem('quizSaved');
        setTimeout(() => notify.remove(), 500);
    }, 3000);
}