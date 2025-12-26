document.addEventListener('DOMContentLoaded', () => {
    const wrapper = document.getElementById('questionsWrapper');
    const addQuestBtn = document.getElementById("addQuestionBtn");
    const saveChangesBtn = document.getElementById("saveChangesBtn");
    const quizNameInput = document.getElementById('quizNameInput');
    const loader = document.getElementById('globalLoader');

    const { doc, getDoc, setDoc, serverTimestamp } = window.fb;
    const db = window.db;
    const quizDocId = sessionStorage.getItem('editQuizId');

    const redCross = `
        <svg viewBox="0 0 24 24" fill="none" style="width:5vw; height:5vw;">
            <path d="M16 8L8 16M8 8L16 16" stroke="#ff4d4d" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    /* ------------------ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ------------------ */

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

    function addAnswer(container, text = '', isChecked = false) {
        const parentBlock = container.closest('.question-block');
        const qIndex = [...wrapper.querySelectorAll('.question-block')].indexOf(parentBlock) + 1;
        const row = document.createElement('div');
        row.className = 'newAnswerLine';
        row.innerHTML = `
            <input class="allInputsStyle baseInputs" placeholder="Вариант ответа" value="${text}">
            <button type="button" class="delete-btn del-a">${redCross}</button>
            <input type="radio" class="nqRadio" name="correctAnswer_group_${qIndex}" ${isChecked ? 'checked' : ''}>
        `;
        row.querySelector('.del-a').onclick = () => {
            if (container.children.length > 1) row.remove();
        };
        container.appendChild(row);
    }

    function createQuestion(data = null) {
        const block = document.createElement('div');
        block.className = 'question-block fade-in';
        block.innerHTML = `
            <div class="question-header">
                <h2 class="nqName">Вопрос</h2>
                <button type="button" class="delete-btn del-q">${redCross}</button>
            </div>
            <input class="allInputsStyle baseInputs qstN" placeholder="Введите вопрос" value="${data ? data.question : ''}">
            <div class="ans-list"></div>
            <button type="button" class="qstBtns add-ans">Добавить вариант ответа</button>
        `;
        const ansList = block.querySelector('.ans-list');

        block.querySelector('.del-q').onclick = () => {
            const currentHeight = block.offsetHeight;
            block.style.height = currentHeight + 'px';
            block.offsetHeight; 
            block.classList.add('removing');
            setTimeout(() => { 
                block.remove(); 
                reindexQuestions(); 
            }, 400);
        };

        block.querySelector('.add-ans').onclick = () => addAnswer(ansList);
        wrapper.appendChild(block);

        if (data && data.answers) {
            data.answers.forEach((ansText, idx) => addAnswer(ansList, ansText, idx === data.correctAnswerIndex));
        } else {
            addAnswer(ansList);
        }
        reindexQuestions();
    }

    /* ------------------ ЗАГРУЗКА ДАННЫХ ------------------ */

    async function loadQuizData() {
        if (!window.db || !window.fb || typeof window.fb.getDoc !== 'function') {
            setTimeout(loadQuizData, 300);
            return;
        }
        if (!quizDocId) {
            loader.classList.remove('active');
            window.location.href = 'draftspage.html';
            return;
        }

        try {
            const docRef = doc(db, 'quizzes', quizDocId);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                quizNameInput.value = data.title || "";
                wrapper.innerHTML = "";
                if (data.questions && data.questions.length > 0) {
                    data.questions.forEach(q => createQuestion(q));
                } else { createQuestion(); }
            }
        } catch (err) {
            console.error("Ошибка:", err);
        } finally {
            loader.classList.remove('active');
        }
    }

    /* ------------------ ВАЛИДАЦИЯ И СОХРАНЕНИЕ ------------------ */

    saveChangesBtn.onclick = async () => {
        let isValid = true;

        // 1. Сброс предыдущих ошибок (идентично конструктору)
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
        document.querySelectorAll('.radio-error').forEach(el => el.classList.remove('radio-error'));
        document.querySelectorAll('.error-hint').forEach(el => el.remove());

        // 2. Проверка названия викторины
        if (!quizNameInput.value.trim()) {
            quizNameInput.classList.add('input-error');
            isValid = false;
        }

        const questions = [];
        const questionBlocks = wrapper.querySelectorAll('.question-block');

        questionBlocks.forEach(block => {
            const qInput = block.querySelector('.qstN');
            const questionText = qInput.value.trim();

            // Проверка текста вопроса
            if (!questionText) {
                qInput.classList.add('input-error');
                isValid = false;
            }

            const answers = [];
            let correctIdx = null;
            const answerRows = block.querySelectorAll('.newAnswerLine');

            answerRows.forEach((row, idx) => {
                const aInput = row.querySelector('input.baseInputs');
                const radio = row.querySelector('.nqRadio');
                const answerValue = aInput.value.trim();

                // Проверка текста ответа
                if (!answerValue) {
                    aInput.classList.add('input-error');
                    isValid = false;
                }

                answers.push(answerValue);
                if (radio.checked) correctIdx = idx;
            });

            // 3. Проверка выбора правильного ответа (Radio)
            if (correctIdx === null) {
                isValid = false;
                // Подсвечиваем радио-кнопки
                block.querySelectorAll('.nqRadio').forEach(r => r.classList.add('radio-error'));
                
                // Добавляем текстовую подсказку
                const hint = document.createElement('span');
                hint.className = 'error-hint';
                hint.textContent = 'Нужно выбрать один правильный ответ';
                block.querySelector('.ans-list').after(hint);
            }

            questions.push({ 
                question: questionText, 
                answers, 
                correctAnswerIndex: correctIdx 
            });
        });

        // Если не валидно, выходим (alert оставлен для подстраховки, как в вашем стиле)
        if (!isValid) return;

        loader.classList.add('active');
        try {
            await setDoc(doc(db, 'quizzes', quizDocId), {
                title: quizNameInput.value.trim(),
                questions,
                questionsCount: questions.length,
                updatedAt: serverTimestamp()
            }, { merge: true });

            sessionStorage.setItem('quizSaved', 'true');
            window.location.href = 'homepage.html';
        } catch (err) {
            loader.classList.remove('active');
            alert("Ошибка при сохранении");
        }
    };

    addQuestBtn.onclick = () => createQuestion();
    loadQuizData();
});