document.addEventListener('DOMContentLoaded', function() {
    const wrapper = document.getElementById('questionsWrapper');
    const addQuestBtn = document.getElementById("setNewQuestion");

    const redCross = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 8L8 16M8 8L16 16" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>`;

    // Функция для пересчета номеров вопросов и имен радиокнопок
    function reindexQuestions() {
        const blocks = wrapper.querySelectorAll('.question-block');
        blocks.forEach((block, index) => {
            const newIndex = index + 1;
            // Обновляем заголовок
            block.querySelector('.nqName').textContent = `Вопрос №${newIndex}`;
            // Обновляем name у всех радиокнопок в этом блоке
            const radios = block.querySelectorAll('.nqRadio');
            radios.forEach(radio => {
                radio.name = `correctAnswer_group_${newIndex}`;
            });
        });
    }

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
        const addAnsBtn = block.querySelector('.add-ans');
        const delQBtn = block.querySelector('.del-q');

        // Инициализация удаления блока вопроса
        delQBtn.onclick = () => {
            const height = block.offsetHeight;
            block.style.height = height + 'px';
            setTimeout(() => block.classList.add('removing'), 10);
            
            setTimeout(() => {
                block.remove();
                reindexQuestions(); // Пересчитываем иерархию после удаления
            }, 400);
        };

        // Логика добавления ответа
        addAnsBtn.onclick = () => addAnswer(ansList);

        wrapper.appendChild(block);
        
        // Сразу добавляем один вариант ответа
        addAnswer(ansList);
        
        // Вызываем пересчет, чтобы назначить правильный индекс новому вопросу
        reindexQuestions();
    }

    function addAnswer(container) {
        // Находим текущий индекс вопроса на основе родительского блока
        const parentBlock = container.closest('.question-block');
        const allBlocks = Array.from(wrapper.querySelectorAll('.question-block'));
        const qIdx = allBlocks.indexOf(parentBlock) + 1;

        const row = document.createElement('div');
        row.className = 'newAnswerLine';
        row.innerHTML = `
            <input class="allInputsStyle baseInputs" placeholder="Вариант ответа">
            <button type="button" class="delete-btn del-a">${redCross}</button>
            <input type="radio" class="nqRadio" name="correctAnswer_group_${qIdx}">
        `;

        row.querySelector('.del-a').onclick = () => {
            if (container.children.length > 1) row.remove();
        };

        container.appendChild(row);
    }

    addQuestBtn.onclick = (e) => {
        e.preventDefault();
        createQuestion();
    };

    // Создаем первый вопрос при загрузке страницы
    createQuestion();
});