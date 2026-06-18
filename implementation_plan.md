# Plano de Implementação: Estatísticas e Sincronização Google Drive

Este plano detalha o design e a implementação do Painel de Estatísticas Financeiras (Histórico) e da Sincronização Cloud em Pasta Privada do Google Drive (Ajustes) no aplicativo **Klif Scan**.

---

## User Review Required

> [!IMPORTANT]
> A sincronização com o Google Drive utilizará o escopo limitado **drive.appdata** (Pasta de Dados do Aplicativo). Esta pasta é privada, oculta para o usuário comum no Drive e isolada, garantindo total privacidade e prevenindo exclusões acidentais.
> O usuário precisará conceder permissão de acesso ao Drive (tela de consentimento do Google) ao clicar em "Conectar Google Drive" na aba Ajustes.

---

## Proposed Changes

### 1. Sistema de Dados e Conflitos (Merge)
Para suportar o sincronismo entre múltiplos dispositivos do mesmo usuário ou família, alteraremos as funções de salvar dados no IndexedDB para registrar e comparar a data de atualização:
- **Shopping Lists:** Adicionaremos a propriedade `lastUpdated: Date.now()` em `saveShoppingList` (similar aos produtos e estoque).
- **Estratégia de Sincronização:** O fluxo baixará os dados remotos do Drive, lerá os dados locais e fará uma mesclagem:
  - **Produtos:** Se o mesmo código de barras existir localmente e remotamente, manterá a versão com o `lastUpdated` mais recente.
  - **Listas de Compras:** Se o ID da lista existir localmente e remotamente, manterá a versão com o `lastUpdated` mais recente. Listas novas serão adicionadas.
  - **Itens de Estoque (Dispensa):** Se o item de estoque existir localmente e remotamente, manterá a versão com `lastUpdated` mais recente.

---

### 2. Painel de Estatísticas de Compras (Aba Histórico)
Adicionaremos um seletor no topo da aba de Histórico para alternar entre a listagem de compras anteriores e o painel de métricas.

#### [MODIFY] [index.html](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/index.html)
- Adicionar o controle segmentado (Segmented Control) no painel de histórico (`panel-history`).
- Criar a estrutura HTML para os cartões de estatísticas:
  - Resumo financeiro (Total gasto acumulado e média por compra).
  - Gráfico de barras de gastos por categoria de produtos.
  - Top 5 produtos mais frequentes nas compras do usuário.
- Adicionar a estrutura visual e os botões de controle para a Sincronização via Google Drive na aba de Ajustes (`panel-settings`).

#### [MODIFY] [css/styles.css](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/css/styles.css)
- Implementar estilos para o seletor segmentado (`.segmented-control` e `.control-item`).
- Criar layouts para os gráficos de barras horizontais utilizando divições CSS flexbox e larguras percentuais com degradê linear.
- Estilizar o painel de status do sincronismo do Google Drive.

---

### 3. Integração com o Google Drive AppData
Desenvolveremos a lógica para gerenciar tokens OAuth2 do Google e fazer o upload/download de arquivos de backup mesclados diretamente na conta do Google Drive do usuário.

#### [NEW] [js/drive.js](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/js/drive.js)
- Implementar a inicialização do Cliente de Token OAuth2 (`google.accounts.oauth2.initTokenClient`) utilizando o mesmo `Client ID` do Google.
- Tratar a expiração de tokens e persistência da autorização (salvando `drive_sync_enabled` no localStorage).
- Métodos auxiliares para:
  - Localizar o arquivo `klif_scan_sync.json` no `appDataFolder`.
  - Ler e escrever os dados de backup estruturados.
  - Resolver conflitos de mesclagem comparando campos `lastUpdated`.

#### [MODIFY] [js/db.js](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/js/db.js)
- Adicionar `list.lastUpdated = Date.now()` ao método `saveShoppingList`.
- Exportar uma função auxiliar de mesclagem em lote para salvar todos os dados reconciliados do sincronizador.

#### [MODIFY] [js/app.js](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/js/app.js)
- Integrar os cliques dos botões de conectar/desconectar Drive e de Sincronismo.
- Implementar as rotinas matemáticas para calcular estatísticas (total gasto, média de gastos, pesos por categorias e top produtos frequentes).
- Atualizar a UI do Histórico para alternar entre as abas e redesenhar os gráficos dinamicamente.
- Disparar a sincronização em segundo plano silenciosamente quando ações importantes forem executadas (ex: finalizar uma compra ou consumir um item), caso o Drive esteja ativo e conectado.

---

### 4. Ciclo de Vida do PWA Cache
#### [MODIFY] [sw.js](file:///g:/MEUS%20ARQUIVOS/CURSOS%20e%20PROJETOS/2%20-%20Projetos/005%20-%20Projeto%20-%20Ler%20Codigo%20Barras/sw.js)
- Adicionar o novo arquivo `js/drive.js` na lista de ativos estáticos (`ASSETS`).
- Incrementar a versão do cache para `v10` para propagação dos novos arquivos modificados.

---

## Verification Plan

### Automated/Unit Verification
- A validação será executada verificando as saídas de console para os algoritmos de mesclagem de banco de dados locais/remotos e o cálculo matemático das estatísticas.

### Manual Verification
1. **Teste de Estatísticas:**
   - Adicionar compras de exemplo no histórico de diferentes categorias (Limpeza, Mercearia, Bebidas) com preços e quantidades distintas.
   - Alternar para a aba Estatísticas no Histórico e verificar se o total acumulado, média e gráfico de barras horizontais em degradê são computados e renderizados corretamente.
2. **Teste de Sincronização Google Drive:**
   - Ir na aba Ajustes, clicar em **Conectar Google Drive**.
   - Aceitar os termos na janela de consentimento do Google.
   - Verificar se o painel muda o status para "Conectado" e exibe o e-mail do usuário.
   - Clicar em **Sincronizar Agora (Mesclar)**, observar a barra de toasts.
   - Modificar dados em um dispositivo fictício ou deletar um produto localmente, clicar em sincronizar e ver se o arquivo remoto é criado e mesclado novamente com os dados corretos.
