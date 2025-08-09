// terminal-plus.js
// ESTE ARQUIVO DEVE ESTAR NO SEU REPOSITÓRIO GITHUB

(function() {
    'use strict';

    console.log('TerminalPMPlus: Script principal carregado e aguardando o terminal...');

    // --- CONFIGURAÇÃO ---
    const GITHUB_REPO_OWNER = 'site15rpm'; // SEU USUÁRIO GITHUB
    const GITHUB_REPO_NAME = 'IntranetPMPlus'; // SEU REPOSITÓRIO
    const GITHUB_MACROS_PATH = 'macros';

    class TerminalPMPlus {
        constructor(term) {
            this.term = term;
            this.macros = {};
            this.githubToken = null;
            this.keyMap = {
                'ENTER': '\r', 'TAB': '\t', 'BACKSPACE': '\x7f', 'DELETE': '\x1b[3~',
                'END': '\x1b[F', 'PF1': '\x1bOP', 'PF2': '\x1bOQ', 'PF3': '\x1bOR',
                'PF4': '\x1bOS', 'PF5': '\x1b[15~', 'PF6': '\x1b[17~', 'PF7': '\x1b[18~',
                'PF8': '\x1b[19~', 'PF9': '\x1b[20~', 'PF10': '\x1b[21~', 'PF11': '\x1b[23~',
                'PF12': '\x1b[24~',
            };
        }

        async init() {
            console.log('TerminalPMPlus: Inicializando...');
            this.githubToken = await this.getStorageData('github_pat');
            this.createMainMenu();
            this.macros = await this.fetchMacrosFromGithub();
            this.populateMacroMenu(this.macros, document.getElementById('tpm-macros-list'));
            this.tryAutoLogin();
        }

        // --- LÓGICA DE COMUNICAÇÃO E STORAGE ---
        getStorageData(key) {
            return new Promise(resolve => {
                const listener = (event) => {
                    if (event.source === window && event.data.type === 'storage_response' && event.data.key === key) {
                        window.removeEventListener('message', listener);
                        resolve(event.data.value);
                    }
                };
                window.addEventListener('message', listener);
                window.postMessage({ type: 'get_storage', key: key }, '*');
            });
        }

        // --- LÓGICA DA API DO GITHUB ---
        async githubApiRequest(endpoint, method = 'GET', body = null) {
            const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/${endpoint}`;
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
            };
            if (this.githubToken ) {
                headers['Authorization'] = `token ${this.githubToken}`;
            }

            const options = { method, headers };
            if (body) {
                options.body = JSON.stringify(body);
            }

            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`GitHub API Error: ${errorData.message}`);
                }
                if (response.status === 204 || response.status === 201) return { success: true }; // No Content or Created
                return await response.json();
            } catch (error) {
                console.error('GitHub API Request Failed:', error);
                this.showNotification(`Erro na API do GitHub: ${error.message}`, false);
                return null;
            }
        }

        async fetchMacrosFromGithub(path = GITHUB_MACROS_PATH) {
            const contents = await this.githubApiRequest(`contents/${path}`);
            if (!contents) return {};

            const structure = {};
            for (const item of contents) {
                if (item.type === 'dir') {
                    structure[item.name] = await this.fetchMacrosFromGithub(item.path);
                } else if (item.name.endsWith('.txt')) {
                    structure[item.name] = { type: 'file', path: item.path, download_url: item.download_url };
                }
            }
            return structure;
        }
        
        // --- LÓGICA DA INTERFACE (UI) ---
        createMainMenu() {
            if (document.getElementById('tpm-menu-container')) return;
            const container = document.createElement('div');
            container.id = 'tpm-menu-container';
            container.innerHTML = `
                <button id="tpm-menu-toggle">☰ TerminalPMPlus</button>
                <div class="tpm-menu-dropdown" id="tpm-main-menu">
                    <div class="tpm-menu-section">Macros</div>
                    <div id="tpm-macros-list">Carregando macros...</div>
                    <div class="tpm-menu-section">Ações</div>
                    <div class="tpm-menu-item" id="tpm-record-macro">⏺️ Gravar Nova Macro</div>
                    <div class="tpm-menu-item" id="tpm-stop-recording" style="display:none;">⏹️ Parar Gravação</div>
                    <div class="tpm-menu-section">Configuração</div>
                    <div class="tpm-menu-item" id="tpm-set-user">👤 Definir Usuário</div>
                    <div class="tpm-menu-item" id="tpm-set-pass">🔑 Definir Senha</div>
                </div>
            `;
            document.body.appendChild(container);

            document.getElementById('tpm-menu-toggle').addEventListener('click', () => {
                const menu = document.getElementById('tpm-main-menu');
                menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            });
            
            // Adicionar listeners para os novos botões
            document.getElementById('tpm-set-user').addEventListener('click', () => this.setCredential('terminal_user', 'Digite seu usuário do terminal:'));
            document.getElementById('tpm-set-pass').addEventListener('click', () => this.setCredential('terminal_pass', 'Digite sua senha do terminal:'));
        }

        populateMacroMenu(structure, parentElement) {
            parentElement.innerHTML = '';
            const sortedKeys = Object.keys(structure).sort();

            for (const key of sortedKeys) {
                const item = structure[key];
                if (item.type === 'file') { // É um arquivo de macro
                    const btn = document.createElement('div');
                    btn.className = 'tpm-menu-item';
                    btn.textContent = `▶️ ${key.replace('.txt', '')}`;
                    btn.onclick = async () => {
                        const response = await fetch(item.download_url);
                        const content = await response.text();
                        this.executeMacro(content);
                    };
                    parentElement.appendChild(btn);
                } else { // É uma pasta (submenu)
                    const subMenuContainer = document.createElement('div');
                    subMenuContainer.className = 'tpm-submenu';
                    const title = document.createElement('div');
                    title.className = 'tpm-menu-item';
                    title.textContent = `📁 ${key}`;
                    title.style.fontWeight = 'bold';
                    title.onclick = (e) => {
                        e.stopPropagation();
                        const subList = e.currentTarget.nextElementSibling;
                        subList.style.display = subList.style.display === 'block' ? 'none' : 'block';
                    };
                    const subList = document.createElement('div');
                    subList.style.display = 'none'; // Começa fechado
                    
                    this.populateMacroMenu(item, subList);
                    
                    subMenuContainer.appendChild(title);
                    subMenuContainer.appendChild(subList);
                    parentElement.appendChild(subMenuContainer);
                }
            }
        }

        // --- LÓGICA DE CREDENCIAIS E NOTIFICAÇÕES ---
        async getStorageData(key) {
            return new Promise(resolve => {
                // Comunicação com o content-script para acessar o chrome.storage
                const listener = (event) => {
                    if (event.data.type === 'storage_response' && event.data.key === key) {
                        window.removeEventListener('message', listener);
                        resolve(event.data.value);
                    }
                };
                window.addEventListener('message', listener);
                window.postMessage({ type: 'get_storage', key: key }, '*');
            });
        }

        async setCredential(key, promptText) {
            const value = prompt(promptText);
            if (value !== null && value.trim() !== '') {
                this.setStorageData(key, value);
                this.showNotification(`${key.includes('user') ? 'Usuário' : 'Senha'} salvo(a) com sucesso!`, true);
            } else if (value !== null) {
                this.showNotification('O valor não pode ser vazio.', false);
            } else {
                this.showNotification('Operação cancelada.', false);
            }
        }

        // --- LÓGICA DE EXECUÇÃO ---
        async tryAutoLogin() {
            const user = await this.getStorageData('terminal_user');
            const pass = await this.getStorageData('terminal_pass');

            if (!user || !pass) {
                console.log('TerminalPMPlus: Credenciais de login automático não encontradas.');
                return;
            }

            if (this.macros['_Login.txt']) {
                const item = this.macros['_Login.txt'];
                const response = await fetch(item.download_url);
                let content = await response.text();
                content = content.replace(/%%USER%%/g, user).replace(/%%PASS%%/g, pass);
                this.executeMacro(content, '_Login');
            }
        }

        async executeMacro(macroContent, macroName = 'Macro') {
            this.showNotification(`▶️ Executando "${macroName.replace('.txt', '')}"...`);
            this.term.focus();
            const lines = macroContent.split('\n');
            for (const line of lines) {
                const upperLine = line.trim().toUpperCase();
                if (this.keyMap[upperLine]) {
                    this.term.paste(this.keyMap[upperLine]);
                } else if (line.trim()) {
                    this.term.paste(line.trim());
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (macroName !== '_Login') {
                this.showNotification(`✔️ "${macroName.replace('.txt', '')}" executada.`);
            }
        }
    }

    // --- PONTO DE ENTRADA ---
    const checkTerminalInterval = setInterval(() => {
        // Como este script está injetado na página, ele tem acesso direto ao 'term'
        if (typeof term !== 'undefined' && typeof term.paste === 'function') {
            clearInterval(checkTerminalInterval);
            console.log('TerminalPMPlus: Objeto "term" encontrado. Iniciando o sistema.');
            
            if (!window.terminalPMPlusInitialized) {
                window.terminalPMPlusInitialized = true;
                const terminalApp = new TerminalPMPlus(term);
                terminalApp.init();
            }
        }
    }, 200);

})();
