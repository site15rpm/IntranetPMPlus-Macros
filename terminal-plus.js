// terminal-plus.js
// ESTE ARQUIVO DEVE ESTAR NO SEU REPOSITÓRIO GITHUB

(function() {
    'use strict';

    // Evita reinicialização
    if (window.terminalPMPlusInitialized) {
        console.log('TerminalPMPlus: Tentativa de reinicialização bloqueada.');
        return;
    }
    window.terminalPMPlusInitialized = true;
    console.log('TerminalPMPlus: Script principal carregado e aguardando o terminal...');

    // --- CONFIGURAÇÃO ---
    const GITHUB_REPO_OWNER = 'site15rpm';
    const GITHUB_REPO_NAME = 'IntranetPMPlus-Macros'; // Repositório onde as MACROS estão salvas
    const GITHUB_MACROS_PATH = 'macros'; // Pasta onde as macros estão
    const ADMIN_USER = 's145320'; // Usuário com permissão para excluir

    class TerminalPMPlus {
        constructor(term) {
            this.term = term;
            this.macros = {};
            this.githubToken = null;
            this.githubUser = null;
            this.isRecording = false;
            this.recordedMacro = [];
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
            await this.loadCredentials();
            this.createMainMenu();
            await this.refreshMacros();
            this.tryAutoLogin();
        }

        // --- LÓGICA DE COMUNICAÇÃO E STORAGE ---
        async loadCredentials() {
            this.githubToken = await this.getStorageData('github_pat');
            if (this.githubToken) {
                this.githubUser = await this.getGithubUser();
            }
        }

        getStorageData(key) {
            return new Promise(resolve => {
                const listener = (event) => {
                    if (event.source === window && event.data.type === 'tpm_storage_response' && event.data.key === key) {
                        window.removeEventListener('message', listener);
                        resolve(event.data.value);
                    }
                };
                window.addEventListener('message', listener);
                window.postMessage({ type: 'tpm_get_storage', key: key }, '*');
            });
        }

        setStorageData(key, value) {
            window.postMessage({ type: 'tpm_set_storage', key: key, value: value }, '*');
        }

        // --- LÓGICA DA API DO GITHUB ---
        async githubApiRequest(endpoint, method = 'GET', body = null) {
            if (!this.githubToken) {
                this.showNotification('Token do GitHub não configurado.', false);
                return null;
            }
            const url = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/${endpoint}`;
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${this.githubToken}`,
                'X-GitHub-Api-Version': '2022-11-28'
            };

            const options = { method, headers, cache: 'no-store' };
            if (body) options.body = JSON.stringify(body);

            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`[${response.status}] ${errorData.message}`);
                }
                if (response.status === 204 || response.status === 201) return { success: true };
                return await response.json();
            } catch (error) {
                console.error('GitHub API Request Failed:', error);
                this.showNotification(`Erro na API GitHub: ${error.message}`, false);
                return null;
            }
        }

        async getGithubUser() {
            const user = await this.githubApiRequest('../../user'); // Endpoint para pegar o usuário autenticado
            if (user) {
                console.log(`Usuário GitHub autenticado: ${user.login}`);
                return user;
            }
            return null;
        }

        async fetchMacrosFromGithub(path = GITHUB_MACROS_PATH) {
            const contents = await this.githubApiRequest(`contents/${path}`);
            if (!contents || !Array.isArray(contents)) return {};

            const structure = {};
            for (const item of contents) {
                if (item.type === 'dir') {
                    structure[item.name] = await this.fetchMacrosFromGithub(item.path);
                } else if (item.name.endsWith('.txt')) {
                    structure[item.name] = { type: 'file', path: item.path, sha: item.sha, download_url: item.download_url };
                }
            }
            return structure;
        }

        async saveMacroToGithub(filePath, content) {
            const fullPath = `${GITHUB_MACROS_PATH}/${filePath}`;
            const existingFile = await this.githubApiRequest(`contents/${fullPath}`);

            const data = {
                message: `Salva macro: ${filePath}`,
                content: btoa(unescape(encodeURIComponent(content))) // Base64 encoding
            };
            if (existingFile && existingFile.sha) {
                data.sha = existingFile.sha; // For updates, provide the blob SHA
            }

            const result = await this.githubApiRequest(`contents/${fullPath}`, 'PUT', data);
            if (result && result.success) {
                this.showNotification(`Macro "${filePath}" salva com sucesso!`, true);
                await this.refreshMacros();
            }
        }

        async deleteMacroFromGithub(filePath, sha) {
            // Permissão de exclusão
            if (!this.githubUser || this.githubUser.login !== ADMIN_USER) {
                this.showNotification(`Você não tem permissão para excluir macros. Apenas '${ADMIN_USER}'.`, false);
                return;
            }

            const fullPath = `${GITHUB_MACROS_PATH}/${filePath}`;
            const result = await this.githubApiRequest(`contents/${fullPath}`, 'DELETE', {
                message: `Exclui macro: ${filePath}`,
                sha: sha
            });

            if (result && result.success) {
                this.showNotification(`Macro "${filePath}" excluída com sucesso!`, true);
                await this.refreshMacros();
            }
        }

        async refreshMacros() {
            this.macros = await this.fetchMacrosFromGithub();
            this.populateMacroMenu(this.macros, document.getElementById('tpm-macros-list'));
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
                    <div id="tpm-macros-list">Carregando...</div>
                    <div class="tpm-menu-section">Ações</div>
                    <div class="tpm-menu-item" id="tpm-record-macro">⏺️ Gravar Nova Macro</div>
                    <div class="tpm-menu-item" id="tpm-stop-recording" style="display:none; background-color: #ffebee;">⏹️ Parar Gravação</div>
                    <div class="tpm-menu-section">Configuração</div>
                    <div class="tpm-menu-item" id="tpm-set-user">👤 Definir Usuário</div>
                    <div class="tpm-menu-item" id="tpm-set-pass">🔑 Definir Senha</div>
                    <div class="tpm-menu-item-static" id="tpm-auth-user"></div>
                </div>
            `;
            document.body.appendChild(container);

            document.getElementById('tpm-menu-toggle').addEventListener('click', () => {
                const menu = document.getElementById('tpm-main-menu');
                menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            });
            
            document.getElementById('tpm-set-user').addEventListener('click', () => this.setCredential('terminal_user', 'Digite seu usuário do terminal:'));
            document.getElementById('tpm-set-pass').addEventListener('click', () => this.setCredential('terminal_pass', 'Digite sua senha do terminal (será salva localmente):'));
            document.getElementById('tpm-record-macro').addEventListener('click', () => this.startRecording());
            document.getElementById('tpm-stop-recording').addEventListener('click', () => this.stopRecording());

            const userDisplay = document.getElementById('tpm-auth-user');
            if(this.githubUser) {
                userDisplay.textContent = `GH: ${this.githubUser.login}`;
                userDisplay.style.color = 'green';
            } else {
                userDisplay.textContent = 'GH: Não autenticado';
                userDisplay.style.color = 'red';
            }
        }

        populateMacroMenu(structure, parentElement) {
            parentElement.innerHTML = !Object.keys(structure).length ? 'Nenhuma macro encontrada.' : '';
            const isAdmin = this.githubUser && this.githubUser.login === ADMIN_USER;

            Object.keys(structure).sort().forEach(key => {
                const item = structure[key];
                if (item.type === 'file') {
                    const macroName = key.replace('.txt', '');
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'tpm-menu-item-container';
                    
                    const btn = document.createElement('button');
                    btn.className = 'tpm-menu-item';
                    btn.textContent = `▶️ ${macroName}`;
                    btn.onclick = async () => {
                        const response = await fetch(item.download_url, {cache: 'no-store'});
                        const content = await response.text();
                        this.executeMacro(content, macroName);
                    };
                    
                    const delBtn = document.createElement('button');
                    delBtn.className = 'tpm-delete-btn';
                    delBtn.textContent = '🗑️';
                    delBtn.title = 'Excluir macro';
                    delBtn.style.display = isAdmin ? 'inline-block' : 'none';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (confirm(`Tem certeza que deseja excluir a macro "${macroName}"?`)) {
                            this.deleteMacroFromGithub(key, item.sha);
                        }
                    };

                    itemDiv.appendChild(btn);
                    itemDiv.appendChild(delBtn);
                    parentElement.appendChild(itemDiv);

                } else {
                    // Lógica para subpastas (se necessário no futuro)
                }
            });
        }
        
        showNotification(message, isSuccess = true) {
            const notification = document.createElement('div');
            notification.className = 'tpm-notification';
            notification.textContent = message;
            notification.style.backgroundColor = isSuccess ? '#4CAF50' : '#F44336';
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        }

        // --- LÓGICA DE CREDENCIAIS E LOGIN ---
        async setCredential(key, promptText) {
            const value = prompt(promptText);
            if (value) { // Salva mesmo que seja string vazia para limpar
                this.setStorageData(key, value);
                this.showNotification(`${key.includes('user') ? 'Usuário' : 'Senha'} salvo(a) com sucesso!`, true);
            } else if (value === null) {
                this.showNotification('Operação cancelada.', false);
            }
        }

        async tryAutoLogin() {
            const user = await this.getStorageData('terminal_user');
            const pass = await this.getStorageData('terminal_pass');
            if (!user || !pass) return;

            // Busca por uma macro específica de login
            const loginMacroKey = Object.keys(this.macros).find(k => k.toLowerCase() === '_login.txt');
            if (loginMacroKey) {
                const item = this.macros[loginMacroKey];
                const response = await fetch(item.download_url, {cache: 'no-store'});
                let content = await response.text();
                content = content.replace(/%%USER%%/g, user).replace(/%%PASS%%/g, pass);
                this.executeMacro(content, '_Login');
            }
        }

        // --- LÓGICA DE GRAVAÇÃO DE MACRO ---
        startRecording() {
            if (this.isRecording) return;
            this.isRecording = true;
            this.recordedMacro = [];
            document.getElementById('tpm-record-macro').style.display = 'none';
            document.getElementById('tpm-stop-recording').style.display = 'block';
            this.showNotification('⏺️ Gravação iniciada...', true);

            // Adiciona listener para capturar o que é enviado ao terminal
            this.term.onData(data => {
                if (this.isRecording) {
                    this.recordedMacro.push(data);
                }
            });
        }

        async stopRecording() {
            if (!this.isRecording) return;
            this.isRecording = false;
            document.getElementById('tpm-record-macro').style.display = 'block';
            document.getElementById('tpm-stop-recording').style.display = 'none';
            this.showNotification('⏹️ Gravação finalizada.', true);

            if (this.recordedMacro.length > 0) {
                const macroName = prompt("Digite o nome do arquivo para a nova macro (ex: minha_macro.txt):");
                if (macroName) {
                    const macroContent = this.recordedMacro.join('');
                    await this.saveMacroToGithub(macroName, macroContent);
                }
            }
        }

        // --- LÓGICA DE EXECUÇÃO ---
        async executeMacro(macroContent, macroName = 'Macro') {
            this.showNotification(`▶️ Executando "${macroName}"...`);
            this.term.focus();
            const lines = macroContent.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                const upperLine = trimmedLine.toUpperCase();
                if (this.keyMap[upperLine]) {
                    this.term.write(this.keyMap[upperLine]);
                } else if (trimmedLine) {
                    this.term.write(trimmedLine);
                }
                // Pequeno delay para o terminal processar
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (macroName !== '_Login') {
                this.showNotification(`✔️ "${macroName}" executada.`);
            }
        }
    }

    // --- PONTO DE ENTRADA ---
    const checkTerminalInterval = setInterval(() => {
        if (typeof term !== 'undefined' && typeof term.write === 'function') {
            clearInterval(checkTerminalInterval);
            console.log('TerminalPMPlus: Objeto "term" encontrado. Iniciando o sistema.');
            const terminalApp = new TerminalPMPlus(term);
            terminalApp.init();
        }
    }, 250);

})();
