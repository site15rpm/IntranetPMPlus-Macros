/**
 * =============================================================================
 * TerminalPlus - Lógica Principal v4.0 (Hospedado no GitHub)
 * 
 * Gerencia macros armazenadas em um repositório do GitHub.
 * Requer configuração de usuário, repositório e um Token de Acesso Pessoal (PAT)
 * para salvar e excluir macros.
 * =============================================================================
 */

// Garante que o script só seja inicializado uma vez, mesmo que seja injetado múltiplas vezes.
if (window.TerminalPlus) {
    console.log("TerminalPlus: Tentativa de reinicialização bloqueada. O sistema já está em execução.");
} else {

    class TerminalPlus {
        constructor(term) {
            this.term = term;
            this.macros = {}; // Cache para o conteúdo das macros já carregadas
            this.triggers = {};
            this.isRecording = false;
            this.recordedSteps = [];
            this.DEFAULT_TYPING_DELAY = 50;
            this.keyMap = {
                'ENTER': '\r', 'TAB': '\t', 'BACKSPACE': '\x7f', 'DELETE': '\x1b[3~',
                'END': '\x1b[F', 'PF1': '\x1bOP', 'PF2': '\x1bOQ', 'PF3': '\x1bOR',
                'PF4': '\x1bOS', 'PF5': '\x1b[15~', 'PF6': '\x1b[17~', 'PF7': '\x1b[18~',
                'PF8': '\x1b[19~', 'PF9': '\x1b[20~', 'PF10': '\x1b[21~', 'PF11': '\x1b[23~',
                'PF12': '\x1b[24~',
            };
            this.screenObserver = null;
            this.isObserverPaused = false;
        }

        async init() {
            console.log("TerminalPlus: Inicializando sistema v4.0 (GitHub)...");
            this.createMenu();
            this.setupListeners();
            await this.loadTriggers();
            await this.fetchMacroList(); // Carrega a lista inicial de macros
        }

        // --- LÓGICA DE COMUNICAÇÃO (Ponte com a Extensão Local) ---
        sendMessageToExtension(payload, callback) {
            const messageListener = (event) => {
                if (event.source === window && event.data.type === 'FROM_EXTENSION' && event.data.originalAction === payload.action) {
                    window.removeEventListener('message', messageListener);
                    if (callback) callback(event.data.payload);
                }
            };
            window.addEventListener('message', messageListener);
            window.postMessage({ type: 'FROM_PAGE_SCRIPT', payload }, '*');
        }

        setupListeners() {
            // Listener para capturar teclas durante a gravação
            this.term.onKey(e => {
                if (this.isRecording) {
                    const specialKey = Object.keys(this.keyMap).find(key => this.keyMap[key] === e.key);
                    if (specialKey) {
                        this.recordedSteps.push(`<${specialKey}>`);
                    } else {
                        // Agrupa digitação normal para manter o texto coeso
                        if (this.recordedSteps.length > 0 && !this.recordedSteps[this.recordedSteps.length - 1].startsWith('<')) {
                            this.recordedSteps[this.recordedSteps.length - 1] += e.key;
                        } else {
                            this.recordedSteps.push(e.key);
                        }
                    }
                    this.updateRecordingStatus();
                }
            });
        }

        // --- LÓGICA DE UI ---
        createMenu() {
            if (document.getElementById('macro-menu-container')) return;
            const menuHTML = `
                <button id="macro-menu-toggle">☰ Macros</button>
                <div id="macro-menu-dropdown" style="display: none;">
                    <div class="macro-menu-section">Macros</div>
                    <button class="macro-menu-item" id="record-macro-btn">⏺️ Gravar Nova Macro</button>
                    <div id="macro-list-container"><div class="macro-menu-item-static">Configure o GitHub...</div></div>
                    
                    <div class="macro-menu-section">Configuração</div>
                    <button class="macro-menu-item" id="set-github-btn">⚙️ Configurar GitHub</button>
                    <button class="macro-menu-item" id="set-user-btn">👤 Definir Usuário Terminal</button>
                    <button class="macro-menu-item" id="set-pass-btn">🔑 Definir Senha Terminal</button>
                    <button class="macro-menu-item" id="manage-triggers-btn">⚡ Gerenciar Gatilhos</button>
                </div>`;
            const menuContainer = document.createElement('div');
            menuContainer.id = 'macro-menu-container';
            menuContainer.innerHTML = menuHTML;
            document.body.appendChild(menuContainer);

            document.getElementById('macro-menu-toggle').addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = document.getElementById('macro-menu-dropdown');
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            });
            
            document.getElementById('record-macro-btn').addEventListener('click', () => this.toggleRecording());
            document.getElementById('set-github-btn').addEventListener('click', () => this.openGitHubConfig());
            document.getElementById('set-user-btn').addEventListener('click', () => this.setLoginCredential('user'));
            document.getElementById('set-pass-btn').addEventListener('click', () => this.setLoginCredential('pass'));
            document.getElementById('manage-triggers-btn').addEventListener('click', () => this.openTriggerManager());

            document.addEventListener('click', () => document.getElementById('macro-menu-dropdown').style.display = 'none');
            document.getElementById('macro-menu-dropdown').addEventListener('click', e => e.stopPropagation());
        }

        populateMacroList(names = []) {
            const container = document.getElementById('macro-list-container');
            container.innerHTML = '';
            const sortedNames = names.filter(name => name !== '_Login').sort();

            if (sortedNames.length === 0) {
                container.innerHTML = `<div class="macro-menu-item-static">Nenhuma macro encontrada.</div>`;
                return;
            }
            sortedNames.forEach(name => {
                const itemContainer = document.createElement('div');
                itemContainer.className = 'macro-menu-item-container';
                itemContainer.innerHTML = `
                    <button class="macro-menu-item macro-exec-btn" data-macro-name="${name}">▶️ ${name}</button>
                    <button class="macro-menu-item-icon macro-edit-btn" data-macro-name="${name}" title="Editar">✏️</button>
                    <button class="macro-menu-item-icon macro-delete-btn" data-macro-name="${name}" title="Excluir">🗑️</button>
                `;
                container.appendChild(itemContainer);
            });

            container.querySelectorAll('.macro-exec-btn').forEach(btn => btn.onclick = () => this.executeMacro(btn.dataset.macroName));
            container.querySelectorAll('.macro-edit-btn').forEach(btn => btn.onclick = () => this.openEditor(btn.dataset.macroName));
            container.querySelectorAll('.macro-delete-btn').forEach(btn => btn.onclick = () => this.deleteMacro(btn.dataset.macroName));
        }

        showNotification(message, isSuccess = true, duration = 4000) {
            const notificationDiv = document.createElement('div');
            notificationDiv.className = 'macro-notification';
            notificationDiv.style.backgroundColor = isSuccess ? '#28a745' : '#dc3545';
            notificationDiv.textContent = message;
            document.body.appendChild(notificationDiv);
            setTimeout(() => notificationDiv.remove(), duration);
        }

        // --- LÓGICA DE CONFIGURAÇÃO ---
        async openGitHubConfig() {
            const user = await this.getStorage('github_user') || '';
            const repo = await this.getStorage('github_repo') || '';
            const token = await this.getStorage('github_token') || '';

            const contentHTML = `
                <p style="font-size: 14px; color: #333; margin-bottom: 15px;">Forneça os detalhes do seu repositório e um Token de Acesso Pessoal (PAT) para salvar e excluir macros.</p>
                <div class="config-row"><label>Usuário GitHub:</label><input id="cfg-gh-user" type="text" value="${user}" placeholder="ex: seu-usuario"></div>
                <div class="config-row"><label>Repositório:</label><input id="cfg-gh-repo" type="text" value="${repo}" placeholder="ex: meu-repo-de-macros"></div>
                <div class="config-row"><label>Token (PAT):</label><input id="cfg-gh-token" type="password" value="${token}" placeholder="Cole seu token aqui"></div>
                <p style="font-size: 12px; color: #666; margin-top: 10px;">O token é salvo apenas no seu computador e é necessário para permitir que a extensão escreva arquivos no seu repositório.</p>
            `;
            this.createModal('Configuração do GitHub', contentHTML, async (modal) => {
                const newUser = modal.querySelector('#cfg-gh-user').value.trim();
                const newRepo = modal.querySelector('#cfg-gh-repo').value.trim();
                const newToken = modal.querySelector('#cfg-gh-token').value.trim();

                await this.setStorage('github_user', newUser);
                await this.setStorage('github_repo', newRepo);
                await this.setStorage('github_token', newToken);

                this.showNotification('Configurações do GitHub salvas!');
                modal.remove();
                this.fetchMacroList(); // Recarrega a lista com as novas configurações
            });
        }

        async setLoginCredential(type) {
            const key = `terminal_${type}`;
            const promptMessage = type === 'user' 
                ? "Digite seu usuário do terminal (será salvo localmente):" 
                : "Digite sua senha do terminal (será salva localmente):";
            
            const currentValue = await this.getStorage(key) || '';
            const value = prompt(promptMessage, currentValue);

            if (value !== null) {
                this.setStorage(key, value);
                this.showNotification(`${type === 'user' ? 'Usuário' : 'Senha'} salvo(a) com sucesso!`);
            }
        }

        // --- LÓGICA DE MACROS ---
        async fetchMacroList() {
            this.sendMessageToExtension({ action: 'fetchMacros' }, (response) => {
                if (response && response.success) {
                    this.populateMacroList(response.data);
                    if (response.data.includes('_Login')) {
                        this.executeMacro('_Login');
                    }
                } else {
                    this.showNotification(response.error || 'Erro ao carregar lista de macros.', false);
                    this.populateMacroList([]);
                }
            });
        }

        async getMacroContent(name) {
            if (this.macros[name]) {
                return this.macros[name];
            }
            return new Promise(resolve => {
                this.sendMessageToExtension({ action: 'fetchMacroContent', name }, (response) => {
                    if (response && response.success) {
                        this.macros[name] = response.data;
                        resolve(response.data);
                    } else {
                        this.showNotification(`Erro ao carregar conteúdo da macro "${name}".`, false);
                        resolve(null);
                    }
                });
            });
        }

        async executeMacro(name) {
            const macroText = await this.getMacroContent(name);
            if (macroText === null) return;

            this.showNotification(`▶️ Executando macro "${name}"...`);
            this.term.focus();

            let processedText = macroText;
            if (name === '_Login') {
                const user = await this.getStorage('terminal_user') || '';
                const pass = await this.getStorage('terminal_pass') || '';
                processedText = processedText.replace(/{USER}/g, user).replace(/{PASS}/g, pass);
            }

            const lines = processedText.split('\n');
            for (const line of lines) {
                const upperLine = line.trim().toUpperCase();
                const specialKey = Object.keys(this.keyMap).find(k => `<${k}>` === upperLine);
                if (specialKey) {
                    this.term.write(this.keyMap[specialKey]);
                } else if (line) {
                    this.term.write(line);
                }
                await new Promise(resolve => setTimeout(resolve, this.DEFAULT_TYPING_DELAY));
            }
            if (name !== '_Login') this.showNotification(`✔️ Macro "${name}" executada.`);
        }

        saveMacro(name, content) {
             this.sendMessageToExtension({ action: 'saveMacro', name, content }, (response) => {
                if (response && response.success) {
                    this.showNotification(`Macro "${name}" salva com sucesso!`);
                    this.macros[name] = content;
                    this.fetchMacroList();
                } else {
                    this.showNotification(response.error || 'Erro ao salvar a macro.', false);
                }
            });
        }

        deleteMacro(name) {
            if (!confirm(`Tem certeza que deseja excluir a macro "${name}" do GitHub? Esta ação não pode ser desfeita.`)) return;
            this.sendMessageToExtension({ action: 'deleteMacro', name }, (response) => {
                if (response && response.success) {
                    this.showNotification(`Macro "${name}" excluída com sucesso.`);
                    delete this.macros[name];
                    this.fetchMacroList();
                } else {
                    this.showNotification(response.error || 'Erro ao excluir a macro.', false);
                }
            });
        }

        // --- GRAVAÇÃO E EDIÇÃO ---
        toggleRecording() {
            this.isRecording = !this.isRecording;
            const recordBtn = document.getElementById('record-macro-btn');
            if (this.isRecording) {
                this.recordedSteps = [];
                recordBtn.textContent = '⏹️ Parar Gravação';
                recordBtn.style.backgroundColor = '#dc3545';
                this.showNotification('Gravação iniciada...', true, 2000);
                this.updateRecordingStatus();
            } else {
                recordBtn.textContent = '⏺️ Gravar Nova Macro';
                recordBtn.style.backgroundColor = '';
                this.showNotification('Gravação parada.', true, 2000);
                document.getElementById('recording-status')?.remove();
                this.saveRecordedMacro();
            }
        }

        updateRecordingStatus() {
            let statusDiv = document.getElementById('recording-status');
            if (!statusDiv) {
                statusDiv = document.createElement('div');
                statusDiv.id = 'recording-status';
                document.body.appendChild(statusDiv);
            }
            statusDiv.textContent = `Gravando... Passos: ${this.recordedSteps.length}`;
        }

        saveRecordedMacro() {
            if (this.recordedSteps.length === 0) return;
            const name = prompt("Digite um nome para a nova macro (sem espaços ou caracteres especiais):");
            if (!name || name.trim() === '') return;
            const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '');
            const content = this.recordedSteps.join('\n');
            this.saveMacro(sanitizedName, content);
        }

        async openEditor(name) {
            const content = await this.getMacroContent(name) || '';
            this.createModal('Editando Macro: ' + name, `<textarea id="modal-textarea">${content}</textarea>`, (modal) => {
                const newContent = modal.querySelector('#modal-textarea').value;
                this.saveMacro(name, newContent);
                modal.remove();
            });
        }

        // --- GATILHOS AUTOMÁTICOS ---
        async loadTriggers() {
            this.triggers = await this.getStorage('macro_triggers') || {};
        }

        startScreenObserver() {
            if (!this.term.element) return;
            this.screenObserver = new MutationObserver(() => {
                if (this.isObserverPaused) return;
                const screenText = this.term.buffer.active.getLine(this.term.buffer.active.cursorY)?.translateToString(true);
                if (screenText) {
                    for (const triggerText in this.triggers) {
                        if (screenText.includes(triggerText)) {
                            const macroToRun = this.triggers[triggerText];
                            this.isObserverPaused = true;
                            this.executeMacro(macroToRun);
                            setTimeout(() => { this.isObserverPaused = false; }, 3000);
                            return;
                        }
                    }
                }
            });
            this.screenObserver.observe(this.term.element, { childList: true, subtree: true });
        }
        
        openTriggerManager() {
            let triggerRows = Object.entries(this.triggers).map(([text, macro]) => `
                <div class="trigger-row">
                    <input type="text" class="trigger-text" value="${text}" placeholder="Texto na tela">
                    <input type="text" class="trigger-macro" value="${macro}" placeholder="Nome da Macro">
                    <button class="trigger-delete-btn">🗑️</button>
                </div>`).join('');
            const managerHTML = `<div id="trigger-list">${triggerRows}</div><button id="add-trigger-btn" style="margin-top: 10px;">+ Adicionar Gatilho</button>`;
            this.createModal('Gerenciador de Gatilhos Automáticos', managerHTML, (modal) => {
                const newTriggers = {};
                modal.querySelectorAll('.trigger-row').forEach(row => {
                    const text = row.querySelector('.trigger-text').value.trim();
                    const macro = row.querySelector('.trigger-macro').value.trim();
                    if (text && macro) newTriggers[text] = macro;
                });
                this.triggers = newTriggers;
                this.setStorage('macro_triggers', this.triggers);
                this.showNotification('Gatilhos salvos!');
                modal.remove();
            });
            const listDiv = document.getElementById('trigger-list');
            document.getElementById('add-trigger-btn').onclick = () => {
                const newRow = document.createElement('div');
                newRow.className = 'trigger-row';
                newRow.innerHTML = `<input type="text" class="trigger-text" placeholder="Texto na tela"><input type="text" class="trigger-macro" placeholder="Nome da Macro"><button class="trigger-delete-btn">🗑️</button>`;
                newRow.querySelector('.trigger-delete-btn').onclick = () => newRow.remove();
                listDiv.appendChild(newRow);
            };
            listDiv.querySelectorAll('.trigger-delete-btn').forEach(btn => btn.onclick = () => btn.parentElement.remove());
        }

        // --- HELPERS ---
        getStorage(key) {
            return new Promise(resolve => {
                this.sendMessageToExtension({ action: 'getStorage', key }, response => resolve(response ? response.value : undefined));
            });
        }

        setStorage(key, value) {
            return new Promise(resolve => {
                this.sendMessageToExtension({ action: 'setStorage', key, value }, resolve);
            });
        }

        createModal(title, contentHTML, onSave) {
            document.querySelector('.macro-modal-backdrop')?.remove();
            const modal = document.createElement('div');
            modal.className = 'macro-modal-backdrop';
            modal.innerHTML = `
                <div class="macro-modal-content">
                    <h3>${title}</h3>
                    ${contentHTML}
                    <div class="macro-modal-actions">
                        <button class="macro-modal-save-btn">Salvar e Fechar</button>
                        <button class="macro-modal-cancel-btn">Cancelar</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('.macro-modal-save-btn').onclick = () => onSave(modal);
            modal.querySelector('.macro-modal-cancel-btn').onclick = () => modal.remove();
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            modal.querySelector('.macro-modal-content').addEventListener('click', e => e.stopPropagation());
        }
    }

    // --- PONTO DE ENTRADA DA APLICAÇÃO ---
    const checkTerminalInterval = setInterval(() => {
        if (typeof term !== 'undefined' && term.element) {
            clearInterval(checkTerminalInterval);
            if (!window.TerminalPlus) {
                console.log('Script Principal: Objeto "term" encontrado. Iniciando o sistema de macros.');
                window.TerminalPlus = new TerminalPlus(term);
                window.TerminalPlus.init();
            }
        }
    }, 200);
}
