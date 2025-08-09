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
        console.log('TerminalPMPlus: Carregando macros...');
        // Adicione aqui a lógica para buscar os arquivos de macro do seu repositório.
        // Exemplo:
        // const response = await this.githubApiRequest(`repos/${this.repoPath}/contents/macros`);
        // if (response.ok) {
        //     this.macros = await response.json();
        //     console.log(`TerminalPMPlus: ${this.macros.length} macros carregadas.`);
        // }
    }

    /**
     * Constrói e injeta a interface do usuário (o menu de macros) na página.
     */
    buildUI() {
        console.log('TerminalPMPlus: Construindo interface do usuário...');
        // Adicione aqui o código que cria o botão e o menu dropdown.
        // O código do seu styles.css será aplicado automaticamente.
    }

    /**
     * Executa uma macro.
     * @param {string} macroContent O conteúdo da macro a ser executado.
     */
    executeMacro(macroContent) {
        if (window.term) {
            // Exemplo: envia o conteúdo da macro para o terminal.
            window.term.io.sendString(macroContent);
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

