/**
 * =============================================================================
 * TerminalPMPlus - Script Principal (v4.0 - Manifest V3)
 * 
 * Este script é injetado na página do Terminal da PMMG e é responsável por:
 * 1. Carregar credenciais (Token do GitHub) de forma segura.
 * 2. Comunicar-se com a API do GitHub através da extensão para evitar CORS.
 * 3. Gerenciar macros e outras funcionalidades da ferramenta.
 * =============================================================================
 */

// --- Funções Auxiliares de Comunicação com a Extensão ---

/**
 * Busca um valor do chrome.storage da extensão de forma assíncrona.
 * @param {string} key A chave a ser buscada.
 * @returns {Promise<any>} O valor encontrado ou undefined.
 */
function getStorageValue(key) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener('message', listener);
            reject(new Error(`Timeout ao buscar a chave '${key}' do storage. A extensão pode estar desativada.`));
        }, 5000);

        const listener = (event) => {
            if (event.source === window && event.data.type === 'tpm_storage_response' && event.data.key === key) {
                clearTimeout(timeout);
                window.removeEventListener('message', listener);
                resolve(event.data.value);
            }
        };

        window.addEventListener('message', listener);
        window.postMessage({ type: 'tpm_get_storage', key: key }, '*');
    });
}

/**
 * Salva um valor no chrome.storage da extensão.
 * @param {string} key A chave onde o valor será salvo.
 * @param {any} value O valor a ser salvo.
 */
function setStorageValue(key, value) {
    window.postMessage({ type: 'tpm_set_storage', key: key, value: value }, '*');
}


/**
 * Classe principal que encapsula toda a lógica do TerminalPMPlus.
 */
class TerminalPMPlus {
    constructor() {
        this.github_pat = null;      // Armazena o GitHub PAT após o carregamento.
        this.github_user = null;     // Armazena os dados do usuário do GitHub.
        this.macros = [];            // Armazena as macros carregadas.
        this.repoPath = 'site15rpm/IntranetPMPlus-Macros'; // Caminho do repositório de macros.
    }

    /**
     * Ponto de entrada. Orquestra a inicialização do sistema.
     */
    async init() {
        console.log('TerminalPMPlus: Sistema iniciando...');

        // 1. Espera o objeto 'term' global da página estar disponível.
        if (!await this.waitForTermObject()) {
            console.error('TerminalPMPlus: Objeto "term" não encontrado na página. A aplicação não pode continuar.');
            return;
        }
        console.log('TerminalPMPlus: Objeto "term" encontrado.');

        // 2. Carrega as credenciais e os dados do usuário. A ordem é crucial.
        await this.loadCredentials();

        // 3. Se as credenciais foram carregadas, carrega as macros.
        if (this.github_user) {
            await this.loadMacros();
        }

        // 4. Constrói a interface do usuário (menu de macros).
        this.buildUI();

        console.log('TerminalPMPlus: Inicialização completa.');
    }

    /**
     * Aguarda o objeto 'term' ser definido na página, com um timeout.
     * @returns {Promise<boolean>} True se o objeto foi encontrado, false caso contrário.
     */
    waitForTermObject() {
        return new Promise(resolve => {
            let attempts = 0;
            const interval = setInterval(() => {
                if (window.term) {
                    clearInterval(interval);
                    resolve(true);
                } else if (attempts > 50) { // Timeout de ~5 segundos
                    clearInterval(interval);
                    resolve(false);
                }
                attempts++;
            }, 100);
        });
    }

    /**
     * Carrega o token do storage e, em seguida, busca os dados do usuário do GitHub.
     */
    async loadCredentials() {
        try {
            console.log('TerminalPMPlus: Carregando token do GitHub...');
            this.github_pat = await getStorageValue('github_pat');

            if (!this.github_pat) {
                console.warn('TerminalPMPlus: Token do GitHub não encontrado no storage. Funções de macro estarão desabilitadas.');
                return;
            }
            
            console.log('TerminalPMPlus: Token encontrado. Autenticando com o GitHub...');
            const response = await this.githubApiRequest('user');

            if (response.ok) {
                this.github_user = await response.json();
                console.log(`TerminalPMPlus: Autenticado com sucesso como "${this.github_user.login}".`);
            } else {
                console.error(`TerminalPMPlus: Falha na autenticação com o GitHub. Status: ${response.status}. Verifique se o token é válido e tem as permissões corretas.`);
                this.github_pat = null; // Invalida o token para evitar mais erros.
            }
        } catch (error) {
            console.error('TerminalPMPlus: Erro crítico ao carregar credenciais.', error);
        }
    }

    /**
     * Envia uma requisição para a API do GitHub através da extensão (background script).
     * @param {string} endpoint O endpoint da API (ex: 'user', 'repos/owner/repo/contents/path').
     * @param {string} method O método HTTP (GET, POST, PUT, DELETE).
     * @param {object|null} body O corpo da requisição (para POST, PUT).
     * @returns {Promise<object>} Um objeto simulando a resposta do fetch.
     */
    githubApiRequest(endpoint, method = 'GET', body = null) {
        return new Promise((resolve, reject) => {
            if (!this.github_pat) {
                // Este erro agora é esperado se o token não for encontrado.
                return reject(new Error("Token do GitHub não encontrado."));
            }

            const url = `https://api.github.com/${endpoint}`;
            const options = {
                method: method,
                headers: {
                    'Authorization': `token ${this.github_pat}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            if (body ) {
                options.body = JSON.stringify(body);
            }

            const timeout = setTimeout(() => {
                window.removeEventListener('message', listener);
                reject(new Error('Timeout na requisição para a extensão.'));
            }, 15000);

            const listener = (event) => {
                if (event.source === window && event.data.type === 'tpm_api_response') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    if (event.data.success) {
                        resolve({
                            ok: event.data.response.ok,
                            status: event.data.response.status,
                            statusText: event.data.response.statusText,
                            json: () => Promise.resolve(event.data.response.data),
                            text: () => Promise.resolve(JSON.stringify(event.data.response.data))
                        });
                    } else {
                        reject(new Error(`Erro na API via extensão: ${event.data.error}`));
                    }
                }
            };

            window.addEventListener('message', listener);
            window.postMessage({ type: 'tpm_api_request', payload: { url, options } }, '*');
        });
    }

    /**
     * Carrega a lista de macros do repositório do GitHub.
     */
    async loadMacros() {
        if (!this.github_user) return; // Não faz nada se não estiver autenticado

        console.log('TerminalPMPlus: Carregando macros do repositório...');
        try {
            // Busca o conteúdo do diretório 'macros' no seu repositório.
            // CRIE UMA PASTA CHAMADA 'macros' NA RAIZ DO SEU REPOSITÓRIO se ainda não existir.
            const response = await this.githubApiRequest(`repos/${this.repoPath}/contents/macros`);

            if (response.ok) {
                const files = await response.json();
                // Filtra para pegar apenas arquivos (e não pastas) e armazena os dados.
                this.macros = files.filter(file => file.type === 'file').map(file => ({
                    name: file.name.replace(/\.[^/.]+$/, ""), // Remove a extensão do arquivo para o nome
                    path: file.path,
                    sha: file.sha
                }));
                console.log(`TerminalPMPlus: ${this.macros.length} macros encontradas.`);
            } else {
                // Trata o caso de o diretório 'macros' não existir.
                if (response.status === 404) {
                    console.warn('TerminalPMPlus: O diretório "macros" não foi encontrado no repositório. Nenhuma macro será carregada.');
                    this.macros = [];
                } else {
                    console.error(`TerminalPMPlus: Falha ao carregar macros. Status: ${response.status}`);
                }
            }
        } catch (error) {
            console.error('TerminalPMPlus: Erro crítico ao carregar macros.', error);
        }
    }

    /**
     * Constrói e injeta a interface do usuário (o menu de macros) na página.
     */
    buildUI() {
        console.log('TerminalPMPlus: Construindo interface do usuário...');

        // Remove qualquer menu antigo para evitar duplicatas ao recarregar.
        const oldContainer = document.getElementById('tpm-menu-container');
        if (oldContainer) oldContainer.remove();

        // Cria o container principal.
        const container = document.createElement('div');
        container.id = 'tpm-menu-container';

        // Cria o botão que abre o menu.
        const toggleButton = document.createElement('button');
        toggleButton.id = 'tpm-menu-toggle';
        toggleButton.textContent = '☰ TerminalPMPlus';

        // Cria o painel do menu dropdown.
        const dropdown = document.createElement('div');
        dropdown.className = 'tpm-menu-dropdown';

        // Adiciona o nome do usuário autenticado (se houver).
        if (this.github_user) {
            const userDiv = document.createElement('div');
            userDiv.id = 'tpm-auth-user';
            userDiv.textContent = `Logado como: ${this.github_user.login}`;
            dropdown.appendChild(userDiv);
        }

        // Adiciona a seção de macros.
        const macrosSection = document.createElement('div');
        macrosSection.className = 'tpm-menu-section';
        macrosSection.textContent = 'Macros Salvas';
        dropdown.appendChild(macrosSection);

        // Adiciona cada macro como um item no menu.
        if (this.macros.length > 0) {
            this.macros.forEach(macro => {
                const menuItem = document.createElement('button');
                menuItem.className = 'tpm-menu-item';
                menuItem.textContent = macro.name;
                menuItem.addEventListener('click', () => {
                    this.executeMacro(macro.path); // Passa o caminho para a função de execução
                    dropdown.style.display = 'none'; // Fecha o menu após clicar
                });
                dropdown.appendChild(menuItem);
            });
        } else {
            const noMacrosItem = document.createElement('div');
            noMacrosItem.className = 'tpm-menu-item-static';
            noMacrosItem.textContent = 'Nenhuma macro encontrada.';
            dropdown.appendChild(noMacrosItem);
        }

        // Monta a estrutura.
        container.appendChild(toggleButton);
        container.appendChild(dropdown);
        document.body.appendChild(container);

        // Adiciona a lógica para abrir/fechar o menu.
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        // Fecha o menu se clicar fora dele.
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });
    }

    /**
     * Busca o conteúdo de uma macro do GitHub e a executa no terminal.
     * @param {string} macroPath O caminho do arquivo da macro no repositório.
     */
    async executeMacro(macroPath) {
        console.log(`TerminalPMPlus: Executando macro de: ${macroPath}`);
        try {
            const response = await this.githubApiRequest(`repos/${this.repoPath}/contents/${macroPath}`);
            if (response.ok) {
                const fileContent = await response.json();
                // O conteúdo de arquivos no GitHub é codificado em base64.
                const decodedContent = atob(fileContent.content);
                
                if (window.term) {
                    window.term.write(decodedContent);
                    console.log('TerminalPMPlus: Macro executada com sucesso.');
                }
            } else {
                console.error(`TerminalPMPlus: Falha ao buscar conteúdo da macro. Status: ${response.status}`);
            }
        } catch (error) {
            console.error('TerminalPMPlus: Erro ao executar macro.', error);
        }
    }
}

// --- Ponto de Entrada da Aplicação ---
// Garante que o script só rode uma vez.
if (!window.TerminalPMPlusInstance) {
    const tpmInstance = new TerminalPMPlus();
    window.TerminalPMPlusInstance = tpmInstance;
    
    // Inicia a aplicação.
    tpmInstance.init();
}

