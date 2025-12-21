document.addEventListener('DOMContentLoaded', function() {
    const questionsForm = document.getElementById('questionsForm');
    const addQuestionBtn = document.getElementById("setNewQuestion");
    let questionCounter = 1;
    
    // Применяем стили к существующему блоку с ответом
    const existingAnswerLine = document.getElementById('newAnswerLine');
    if (existingAnswerLine) {
        existingAnswerLine.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';
        
        const existingInput = existingAnswerLine.querySelector('input[placeholder="Введите вариант ответа"]');
        if (existingInput) existingInput.style.cssText = 'flex: 1;';
        
        const existingDeleteBtn = existingAnswerLine.querySelector('#deleteAnswer');
        if (existingDeleteBtn) {
            existingDeleteBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;';
        }
        
        const existingRadio = existingAnswerLine.querySelector('.nqRadio');
        if (existingRadio) {
            existingRadio.style.cssText = 'margin-left: 10px;';
            existingRadio.name = 'correctAnswer_0';
        }
    }
    
    // Обработчик для добавления нового вопроса
    addQuestionBtn?.addEventListener('click', function(e) {
        e.preventDefault();
        addNewQuestion();
    });
    
    // Делегирование событий для удаления и добавления ответов
    questionsForm.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Удаление варианта ответа
        if (e.target.closest('#deleteAnswer')) {
            const deleteBtn = e.target.closest('#deleteAnswer');
            const answerLine = deleteBtn.closest('.newAnswerLine') || deleteBtn.closest('#newAnswerLine');
            
            if (answerLine) {
                answerLine.remove();
            }
        }
        
        // Удаление вопроса
        else if (e.target.closest('#deleteQuestion')) {
            const deleteBtn = e.target.closest('#deleteQuestion');
            const questionBlock = deleteBtn.closest('.question-block');
            
            if (questionBlock) {
                questionBlock.remove();
            }
        }
        
        // Добавление нового ответа
        else if (e.target.closest('#setNewAnswer') || e.target.closest('.qstBtns:not(#setNewQuestion)')) {
            const addBtn = e.target.closest('#setNewAnswer') || e.target.closest('.qstBtns:not(#setNewQuestion)');
            const questionBlock = addBtn.closest('.question-block');
            
            if (questionBlock) {
                addNewAnswerLine(questionBlock, addBtn);
            } else {
                // Для первого вопроса
                const firstQuestionBlock = document.querySelector('.question-block[data-question-index="0"]');
                if (firstQuestionBlock) {
                    addNewAnswerLine(firstQuestionBlock, addBtn);
                }
            }
        }
    });
    
    // Функция для добавления нового варианта ответа
    function addNewAnswerLine(questionBlock, addButton) {
        const currentQuestionIndex = questionBlock.dataset.questionIndex;
        
        const newAnswerLine = document.createElement('div');
        newAnswerLine.className = 'newAnswerLine';
        newAnswerLine.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';
        
        // Создаем input для ответа
        const answerInput = document.createElement('input');
        answerInput.className = 'allInputsStyle baseInputs';
        answerInput.placeholder = 'Введите вариант ответа';
        answerInput.style.cssText = 'flex: 1;';
        
        // Создаем кнопку удаления
        const deleteBtn = document.createElement('button');
        deleteBtn.id = 'deleteAnswer';
        deleteBtn.type = 'button';
        deleteBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;';
        
        // Создаем SVG для кнопки удаления
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M16 8L8 16M8.00001 8L16 16');
        path.setAttribute('stroke', '#000000');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        
        svg.appendChild(path);
        deleteBtn.appendChild(svg);
        
        // Создаем radio button
        const radioBtn = document.createElement('input');
        radioBtn.className = 'nqRadio';
        radioBtn.type = 'radio';
        radioBtn.name = `correctAnswer_${currentQuestionIndex}`;
        radioBtn.style.cssText = 'margin-left: 10px;';
        
        // Добавляем элементы
        newAnswerLine.appendChild(answerInput);
        newAnswerLine.appendChild(deleteBtn);
        newAnswerLine.appendChild(radioBtn);
        
        // Вставляем новый ответ перед кнопкой "Добавить вариант ответа"
        questionBlock.insertBefore(newAnswerLine, addButton);
    }
    
    // Функция для добавления нового вопроса
    function addNewQuestion() {
        questionCounter++;
        
        // Создаем контейнер для нового вопроса
        const questionBlock = document.createElement('div');
        questionBlock.className = 'question-block';
        questionBlock.dataset.questionIndex = questionCounter;
        questionBlock.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;';
        
        // Создаем заголовок вопроса с кнопкой удаления
        const questionHeader = document.createElement('div');
        questionHeader.style.cssText = 'display: flex; align-items: center;';
        
        const questionTitle = document.createElement('h2');
        questionTitle.className = 'nqName';
        questionTitle.textContent = `Новый вопрос ${questionCounter}`;
        questionTitle.style.cssText = 'display: flex; width: 100%; justify-content: space-between; margin-top: 0vw; font-size: 5.5vw;';
        
        const deleteQuestionBtn = document.createElement('button');
        deleteQuestionBtn.id = 'deleteQuestion';
        deleteQuestionBtn.type = 'button';
        deleteQuestionBtn.style.cssText = 'height: 3em; margin-top: -1.4vw; border: none; padding: 0; background: #fff; aspect-ratio: 1/1;';
        
        // SVG для кнопки удаления вопроса
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M16 8L8 16M8.00001 8L16 16');
        path.setAttribute('stroke', '#000000');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        
        svg.appendChild(path);
        deleteQuestionBtn.appendChild(svg);
        
        questionHeader.appendChild(questionTitle);
        questionHeader.appendChild(deleteQuestionBtn);
        
        // Создаем блок для ввода вопроса
        const questionInputDiv = document.createElement('div');
        questionInputDiv.className = 'newQuestLine';
        
        const questionInput = document.createElement('input');
        questionInput.className = 'allInputsStyle baseInputs qstN';
        questionInput.placeholder = 'Введите вопрос';
        
        questionInputDiv.appendChild(questionInput);
        
        // Создаем первый блок ответа
        const firstAnswerDiv = document.createElement('div');
        firstAnswerDiv.className = 'newAnswerLine';
        firstAnswerDiv.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';
        
        const answerInput = document.createElement('input');
        answerInput.className = 'allInputsStyle baseInputs';
        answerInput.placeholder = 'Введите вариант ответа';
        answerInput.style.cssText = 'flex: 1;';
        
        const deleteAnswerBtn = document.createElement('button');
        deleteAnswerBtn.id = 'deleteAnswer';
        deleteAnswerBtn.type = 'button';
        deleteAnswerBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;';
        
        // SVG для кнопки удаления ответа
        const deleteAnswerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        deleteAnswerSvg.setAttribute('viewBox', '0 0 24 24');
        deleteAnswerSvg.setAttribute('width', '24');
        deleteAnswerSvg.setAttribute('height', '24');
        
        const deleteAnswerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        deleteAnswerPath.setAttribute('d', 'M16 8L8 16M8.00001 8L16 16');
        deleteAnswerPath.setAttribute('stroke', '#000000');
        deleteAnswerPath.setAttribute('stroke-width', '1.5');
        deleteAnswerPath.setAttribute('stroke-linecap', 'round');
        deleteAnswerPath.setAttribute('stroke-linejoin', 'round');
        
        deleteAnswerSvg.appendChild(deleteAnswerPath);
        deleteAnswerBtn.appendChild(deleteAnswerSvg);
        
        const radioBtn = document.createElement('input');
        radioBtn.className = 'nqRadio';
        radioBtn.type = 'radio';
        radioBtn.name = `correctAnswer_${questionCounter}`;
        radioBtn.style.cssText = 'margin-left: 10px;';
        
        firstAnswerDiv.appendChild(answerInput);
        firstAnswerDiv.appendChild(deleteAnswerBtn);
        firstAnswerDiv.appendChild(radioBtn);
        
        // Создаем кнопку "Добавить вариант ответа" для нового вопроса
        const addAnswerBtnForNewQuestion = document.createElement('button');
        addAnswerBtnForNewQuestion.id = 'setNewAnswer';
        addAnswerBtnForNewQuestion.className = 'qstBtns';
        addAnswerBtnForNewQuestion.textContent = 'Добавить вариант ответа';
        
        // Собираем все элементы вместе
        questionBlock.appendChild(questionHeader);
        questionBlock.appendChild(questionInputDiv);
        questionBlock.appendChild(firstAnswerDiv);
        questionBlock.appendChild(addAnswerBtnForNewQuestion);
        
        // Вставляем новый вопрос перед кнопкой "Добавить новый вопрос"
        questionsForm.insertBefore(questionBlock, addQuestionBtn);
    }
});