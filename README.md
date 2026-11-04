# Livro Perto

O Livro Perto é uma plataforma comunitária para encontrar livros disponíveis nas bibliotecas de uma única cidade. A experiência pública é simples e direta: pesquisar em toda a cidade ou escolher uma biblioteca para navegar por seu acervo.

## Arquitetura

```text
GitHub Pages (Vite + React + TypeScript)
        │ fetch REST + CORS
        ▼
Cloudflare Worker (TypeScript)
        │ prepared statements
        ▼
Cloudflare D1 (SQLite relacional)
```

- `src/`: frontend estático, responsivo e acessível.
- `src/api.ts`: cliente HTTP, sessão JWT e normalização dos dados da API.
- `src/storage.ts`: fallback local somente para demonstração/offline.
- `worker/src/`: API Cloudflare Worker.
- `worker/migrations/`: schema relacional versionado do D1, incluindo perfis/escopos (`0005_access_control.sql`) e seções por biblioteca (`0006_library_sections.sql`).
- `worker/seed.sql`: não cria usuário padrão; o catálogo e as credenciais começam vazios.

## Rodar o frontend localmente

Requisitos: Node.js 20+.

```bash
npm install
npm --prefix worker install
npm run dev:full
```

Esse é o caminho recomendado para testar a aplicação completa. O comando aplica as migrations do D1 local e sobe o Worker e o Vite juntos:

- Frontend: `http://localhost:5173`
- API: `http://localhost:8787`
- Admin local: crie um usuário com o procedimento abaixo usando `--local`.
- Catálogo: vazio até você cadastrar bibliotecas e livros reais.

Para parar os dois serviços, pressione `Ctrl+C` no terminal.

Sem `VITE_API_URL`, o site fica em modo local sem catálogo. Para usar a API local do Worker:

```bash
cd worker
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Em outro terminal, rode o frontend apontando para `http://localhost:8787`:

```bash
$env:VITE_API_URL = "http://localhost:8787"
npm run dev
```

No macOS/Linux: `VITE_API_URL=http://localhost:8787 npm run dev`.

Comandos separados úteis:

```bash
npm run dev:setup  # migrations + seed local
npm run dev:api    # somente Worker em localhost:8787
npm run dev        # somente frontend
```

O arquivo `worker/.dev.vars.example` pode ser copiado para `worker/.dev.vars` para sobrescrever segredos durante o desenvolvimento. Não versione esse arquivo.

## Cache

O catálogo público tem duas camadas de cache:

- O frontend mantém resultados em memória e `localStorage` por alguns segundos, acelerando a navegação e mantendo o último catálogo disponível durante uma nova consulta.
- O Worker envia `Cache-Control` para `GET /api/books`, `GET /api/libraries` e `/api/health`, e usa a Cache API da Cloudflare com `max-age=30` e `stale-while-revalidate=120`.

Após qualquer alteração administrativa em livros, exemplares ou bibliotecas, o cliente invalida o cache local. No deploy, a atualização do conteúdo público também pode aguardar até 30 segundos para expirar no cache distribuído.

## Cadastro de livros por nome, ISBN ou ID

### Interface e coleta no celular

Na busca externa, **Base de pesquisa** permite escolher **Automática**, **Open Library** ou **Big Book**. A Open Library funciona sem chave. A Big Book exige o secret `BIG_BOOK_API_KEY` no Worker (Cloudflare → Worker `livro-perto-api` → Settings → Variables and Secrets → Add → Secret). A chave deve ser obtida na conta do serviço; não a coloque em variáveis `VITE_` ou no Git. Para desenvolvimento local, use `worker/.dev.vars`. [Autenticação e busca Big Book](https://bigbookapi.com/docs/).

O Worker aceita `GET /api/admin/external-books?query=...&provider=auto|openlibrary|bigbook`. Em modo automático, usa as bases configuradas como alternativa quando a primeira falha ou não encontra resultados. Uma consulta válida sem resultados retorna uma lista vazia; indisponibilidade de todas as bases retorna erro, sem guardar a falha no cache.

A interface mantém a paleta escura com destaques vermelhos. O painel tem navegação inferior no celular, formulários em tela cheia e cartões de livros com capa, título, autores, ano e ISBN. Capas ausentes usam um marcador neutro.

Em **Livros → Adicionar livro**, a busca mostra opções para conferir antes da importação. Em **Coleta rápida**, escolher o resultado não faz uma nova requisição: os dados são confirmados na tela e **Salvar e próximo** envia livro e exemplar juntos. A biblioteca, a seção e a prateleira são mantidas na sessão, e o foco volta à busca após salvar. A aba **Já está no acervo** reutiliza os livros carregados, sem consultar a base externa.

As consultas externas usam cache de cinco minutos no navegador, cache de um minuto no Worker e deduplicação de buscas simultâneas. A busca usa metadados de edição na mesma resposta, evitando uma requisição extra para cada resultado. ISBN e IDs de edição preservam o registro encontrado; resultados de obra sem edição confirmada são identificados na tela. A primeira consulta ainda depende da latência e disponibilidade das bases externas. [Documentação da busca Open Library](https://openlibrary.org/dev/docs/api/search).

O endpoint `POST /api/admin/books/import` também aceita `{ selection, holding }` e retorna `{ ...book, holding }`. Para um livro novo, livro e exemplar são gravados em um único batch transacional D1. Repetir a mesma seleção atualiza o exemplar existente; acesso à biblioteca e seção é validado antes da gravação.

### Verificação local

Para executar as novas suítes de testes, use Node.js 24+:

```bash
npm test
npm --prefix worker test
npm run build
npm --prefix worker run typecheck
```

Os testes cobrem cache/deduplicação no cliente, recuperação de erros, payload combinado, resolução por ISBN, permissões, repetição do salvamento e rollback da transação. A suíte do Worker usa SQLite em memória e as migrations reais; não acessa o banco de produção.

No painel administrativo, abra **Adicionar livro → Buscar livro** e informe um título, ISBN ou identificador da Open Library, por exemplo:

```text
nome do livro
9788522031445
OL45804W
https://openlibrary.org/works/OL45804W
```

O endpoint `POST /api/admin/books/import` consulta a Open Library, evita duplicatas pela referência externa e cria o livro com título, autores, ISBN, ano, assunto, gênero, capa e a referência `externalSource`/`externalId`. A descrição não é duplicada nesse fluxo, reduzindo o espaço usado no D1. Depois da importação, o painel abre o editor para você informar em quais bibliotecas o exemplar foi conferido.

Se a Open Library estiver indisponível, o cadastro manual continua disponível. A capa é uma URL externa; nenhuma imagem é copiada para o servidor do Livro Perto.

## Configuração da cidade

O padrão é `Sua cidade`. Para personalizar a instância, defina no build do frontend:

```bash
VITE_CITY_NAME="Nome da cidade" VITE_CITY_SYMBOL="✦" npm run build
```

O backend possui a variável `CITY_NAME` no `worker/wrangler.toml`. O frontend usa esse nome na busca global, na home, no rodapé e na escolha de caminhos.

Bibliotecas podem ser classificadas como `escolar` ou `publica_comunitaria` e possuem `imageUrl`. O painel aceita URL ou upload de imagem de até 2 MB. Com Cloudinary configurado, o arquivo vai direto para o preset unsigned e somente a URL segura é salva no D1; sem Cloudinary, o modo local usa Data URL.

## Área administrativa e coleta no celular

A área administrativa não aparece na navegação pública. O caminho padrão é `/admin/login`, portanto no domínio final será `https://site.com/admin/login`. Altere-o com `VITE_ADMIN_PATH` no build se necessário. Isso é apenas uma camada de discrição: a proteção real continua sendo o JWT e a autorização do Worker.

O menu **Coleta rápida** foi pensado para uso em bibliotecas: selecione a biblioteca uma vez, busque pelo nome/ISBN/ID, confirme quantidade e disponíveis, informe a prateleira e toque em **Salvar e próximo**.

Esboço de permissões:

- **Admin do site:** administra todas as bibliotecas, livros, sugestões, usuários, integrações e configurações gerais.
- **Admin da biblioteca:** administra somente a biblioteca atribuída, seus exemplares, disponibilidade e localização interna. A separação visual está preparada no dashboard; a restrição por biblioteca será aplicada quando os usuários por biblioteca forem ativados.

## Cloudinary

Crie um upload preset **unsigned** no Cloudinary e configure no Worker `CLOUDINARY_CLOUD_NAME` e `CLOUDINARY_UPLOAD_PRESET` (variáveis ou secrets no painel da Cloudflare). Nunca coloque `CLOUDINARY_API_SECRET` no frontend. O endpoint protegido `GET /api/admin/media/config` informa se o recurso está habilitado. A mesma camada poderá receber capas, fotos de bibliotecas e documentos futuramente.

## Deploy do backend Cloudflare

1. Instale e autentique o Wrangler: `cd worker && npx wrangler login`.
2. Crie o banco e copie o ID para `worker/wrangler.toml`:

   ```bash
   npx wrangler d1 create livro-perto-db
   ```

3. Defina um segredo JWT forte: `npx wrangler secret put JWT_SECRET`.
4. Ajuste `CORS_ORIGIN` para a URL do GitHub Pages. Para múltiplas origens, use valores separados por vírgula.
5. Aplique migration e seed no banco remoto:

   ```bash
   npx wrangler d1 migrations apply livro-perto-db --remote
   npx wrangler d1 execute livro-perto-db --remote --file=seed.sql
   ```

6. Publique: `npm run deploy`.

Depois, gere o frontend com `VITE_API_URL="https://seu-worker.workers.dev" npm run build`.

### Criar ou trocar o administrador

O usuário demonstrativo `admin@livroperto.org` foi removido e não é recriado pelo seed. Depois de aplicar a migration no banco remoto, crie o primeiro administrador com senha digitada de forma interativa:

```bash
node worker/scripts/create-admin.mjs seu-email@exemplo.com
```

Para apenas testar localmente:

```bash
node worker/scripts/create-admin.mjs seu-email@exemplo.com --local
```

O script gera o hash PBKDF2 e executa o `wrangler d1 execute` no banco escolhido. Para trocar a senha, execute novamente com outro e-mail somente se for criar outro admin; para alterar a senha de um usuário existente, entre em **Administração → Usuários**, edite o usuário e informe a nova senha. Não coloque a senha, o hash ou `JWT_SECRET` no Git.

## Deploy no GitHub Pages

O frontend é estático e não deve receber segredos. A URL da API (`VITE_API_URL`) pode ser pública; `JWT_SECRET` fica somente no Cloudflare Worker.

1. Crie um repositório no GitHub e envie este projeto para a branch `main`.
2. No repositório, abra **Settings → Pages → Source: GitHub Actions**.
3. Em **Settings → Secrets and variables → Actions → Variables**, crie:

   - `VITE_API_URL`: URL pública do Worker, por exemplo `https://livro-perto-api.seu-subdominio.workers.dev`.
   - `VITE_CITY_NAME`: nome da cidade.
   - `VITE_CITY_SYMBOL`: símbolo opcional.
   - `VITE_BASE_PATH`: `/` para `usuario.github.io` ou domínio próprio como `site.com`; para um site de projeto, use `/<nome-do-repositorio>/`.
   - `VITE_ADMIN_PATH`: caminho do painel. Use `/admin` para acessar `https://site.com/admin`.

4. Faça um push na `main` ou execute manualmente a action **Deploy Livro Perto no GitHub Pages**.
5. O workflow em `.github/workflows/deploy-pages.yml` instala as dependências, gera `dist/` com a URL da API e publica o artefato.
6. Configure no Worker `CORS_ORIGIN` com a URL final do Pages, incluindo a subpasta se houver. Exemplo: `https://usuario.github.io/meu-repositorio`.

Para usar `https://site.com`, configure o domínio personalizado em **Settings → Pages → Custom domain** e depois os registros DNS no seu provedor. Com domínio próprio, mantenha `VITE_BASE_PATH=/`; o login ficará em `https://site.com/admin/login`. O GitHub recomenda configurar o domínio no Pages antes dos registros DNS e habilitar HTTPS quando estiver disponível. [Documentação oficial de domínio personalizado](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

O backend precisa estar publicado antes do frontend. Após o deploy, abra `https://site.com/admin` ou `https://site.com/admin/login`.

## API REST

### Rotas públicas

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/api/health` | Verifica API e cidade configurada |
| GET | `/api/books` | Busca, filtros `q`, `genre`, `author`, `libraryId`, `availability` e paginação |
| GET | `/api/books/:id` | Detalhes e bibliotecas associadas |
| GET | `/api/libraries` | Lista bibliotecas e quantidade de títulos |
| GET | `/api/libraries/:id` | Detalhes e acervo da biblioteca |
| POST | `/api/suggestions` | Recebe sugestão ou correção sem login |

### Rotas administrativas

Todas exigem `Authorization: Bearer <JWT>`.

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/api/auth/login` | Login JWT |
| POST | `/api/auth/logout` | Finaliza a sessão no cliente |
| GET/POST | `/api/admin/books` | Lista ou cadastra livros manualmente |
| POST | `/api/admin/books/import` | Adiciona livro por nome, ISBN ou ID da Open Library |
| PUT/DELETE | `/api/admin/books/:id` | Edita ou remove logicamente um livro |
| POST | `/api/admin/books/:id/libraries` | Associa exemplar a uma biblioteca |
| PUT/DELETE | `/api/admin/library-books/:id` | Atualiza ou remove associação |
| GET/POST | `/api/admin/libraries` | Lista ou cadastra bibliotecas |
| PUT/DELETE | `/api/admin/libraries/:id` | Edita ou remove biblioteca logicamente |
| GET | `/api/admin/suggestions` | Lista sugestões; aceita filtro `status` |
| PUT | `/api/admin/suggestions/:id` | Atualiza status da sugestão |
| GET | `/api/admin/stats` | Totais e livros mais pesquisados |
| GET | `/api/admin/export/csv` | Exporta o acervo |
| GET | `/api/admin/external-books?query=...` | Proxy normalizado da Open Library; Google Books opcional |
| GET | `/api/admin/media/config` | Informa se o upload Cloudinary está habilitado |

## Integração com bases externas

O cadastro administrativo oferece “Buscar em base externa”. O Worker consulta a Open Library e normaliza título, autores, ISBN, ano, assunto, descrição e capa. Se `GOOGLE_BOOKS_API_KEY` estiver configurada, ela pode servir como segunda fonte quando a Open Library não retornar resultados.

Na coleta rápida, a busca apresenta várias opções antes de importar. Quando a Open Library possui uma edição em português, o sistema usa o título, ISBN e capa dessa edição; categorias comuns são normalizadas para português, como `Ficção científica`, `Fantasia`, `Infantil`, `História` e `Biografia`.

Essa busca é auxiliar: se estiver indisponível, o formulário continua aceitando cadastro manual. Em produção, respeite limites, termos de uso e atribuições das APIs externas.

## Segurança

- Queries D1 usam prepared statements.
- Rotas administrativas verificam JWT, perfil e escopo de bibliotecas. Os perfis são `admin`, `manager`, `categorizer` e `viewer`.
- Senhas são verificadas com PBKDF2-SHA-256; não ficam em texto puro.
- CORS é configurável por origem.
- Sugestões aceitam apenas campos necessários e têm limite de tamanho.
- `localStorage` é somente fallback/cache de demonstração; o estado de produção fica no D1.
- Em produção, configure `JWT_SECRET` e crie o primeiro administrador pelo script de bootstrap.

## Validações executadas

- `npm run build` do frontend: aprovado.
- `npm run typecheck` do Worker: aprovado.
- Migrations do D1 local, incluindo remoção do catálogo demonstrativo: aprovadas.
- Seed local sem livros/bibliotecas fictícios: aprovado.
- API local: health, livros, bibliotecas e detalhes responderam HTTP 200.
- Login JWT e `/api/admin/stats`: aprovados.
- POST de sugestão pública: aprovado.
- CRUD de livro, associação de exemplar, edição e exclusão lógica: aprovados.
- Criação/edição de biblioteca com imagem e alternância escolar/comunitária: aprovada.

O preview visual automatizado por navegador não pôde ser concluído neste ambiente, mas os breakpoints mobile-first permanecem no CSS e o build inclui as telas públicas e administrativas.

## Estado do produto

Pronto para produção após configurar Cloudflare, D1, segredo JWT, origem CORS, domínio e workflow do GitHub Pages. O mapa geral ainda é ilustrativo; os detalhes das bibliotecas já oferecem link para coordenadas no Google Maps. Reservas e integrações diretas com os sistemas das bibliotecas continuam preparadas como próxima etapa.
"# LibriCN.github.io" 
