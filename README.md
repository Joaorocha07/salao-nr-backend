# salao-nr-backend

API do Espaço NR CRM: autenticação JWT própria com suporte a **múltiplas
empresas por usuário** (a mesma conta pode acessar duas unidades/empresas,
escolhendo qual delas usar no login), e os recursos de negócio (leads,
equipe, campanhas, configurações) hoje simulados em `localStorage` no
front-end.

Ver a fundo o funcionamento do JWT em [`docs/JWT.md`](docs/JWT.md).

## Stack

- Node.js + TypeScript + Express
- Prisma ORM sobre PostgreSQL (mesmo projeto Supabase do front-end, mas via
  conexão direta ao banco — não pela chave `anon`/`publishable`)
- JWT (`jsonwebtoken`) para access tokens, tokens opacos com hash SHA-256
  para refresh tokens
- `bcryptjs` para hash de senha, `zod` para validação, `helmet` +
  `express-rate-limit` para hardening básico

## Por que não usar a `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`?

Essa chave é a `anon key` do Supabase: pública por design, pensada para ser
usada **no navegador** sob Row Level Security. Este backend faz autenticação
própria (senha com hash, emissão de JWT), então ele precisa falar
diretamente com o Postgres com um usuário de banco privilegiado — isso é a
`DATABASE_URL`, não a chave publicável. Nunca coloque a `DATABASE_URL` (ou
qualquer segredo) no front-end.

## Configuração

```bash
cp .env.example .env
```

Preencha `DATABASE_URL` com a connection string do Postgres do seu projeto
Supabase (Project Settings → Database → Connection string; use a porta 5432
"Session" para migrations, ou a porta 6543 "Transaction pooling" com
`?pgbouncer=true` para o app em produção). Gere segredos JWT fortes:

```bash
openssl rand -hex 64   # rode 3x, um para cada JWT_*_SECRET
```

Instale dependências e rode as migrations:

```bash
npm install
npm run prisma:migrate      # cria as tabelas no banco
npm run seed                 # cria as 2 empresas de exemplo + usuário admin
npm run dev                   # inicia em http://localhost:3333
```

Login de exemplo criado pelo seed: `contato@espaconr.com.br` /
`MudeEstaSenha123` (troque a senha em produção).

## Deploy no Render

- Configure `NODE_ENV=production` nas variáveis de ambiente do serviço.
- O Build Command deve instalar as dependências, gerar o Prisma Client e compilar
  o TypeScript: `npm ci --include=dev && npm run prisma:generate && npm run build`.
- Use `node dist/server.js` como Start Command e `/health` como Health Check Path.
- A API reconhece `RENDER=true` (definida automaticamente pela plataforma) e
  confia em um proxy para identificar o IP do cliente nos rate limiters.
- Após publicar alterações em `src/`, faça um novo deploy com build para atualizar `dist/`.

## Estrutura

```
prisma/schema.prisma       modelo de dados (Company, User, CompanyMembership, Lead, ...)
src/config/env.ts          validação das variáveis de ambiente
src/lib/                   jwt, hash de senha, erros HTTP, prisma client
src/middlewares/           autenticação, papéis, validação, rate limit, erros
src/modules/auth/          registro, login em 2 etapas, refresh, troca/recuperação de senha
src/modules/users/         equipe (membros) de cada empresa
src/modules/leads/         CRM: leads, notas, mensagens, agendamento, histórico
src/modules/settings/      configurações por empresa
```

## Modelo multi-empresa

- `Company`: cada unidade/empresa (dados isolados).
- `User`: conta única por e-mail, pode ser compartilhada entre empresas.
- `CompanyMembership`: liga um `User` a uma `Company` com um papel
  (`ADMIN`/`EMPLOYEE`). É essa tabela que resolve "a mesma pessoa loga e
  escolhe em qual empresa entrar".
- Toda tabela de negócio (`Lead`, `CompanySettings`, ...) tem
  `companyId`, e todo acesso é filtrado por `req.auth.companyId` — que vem
  do JWT, não de um parâmetro que o cliente possa manipular.

## Principais rotas

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/auth/register` | Cria a 1ª empresa + usuário administrador |
| POST | `/api/auth/login` | Login com e-mail/senha; retorna sessão OU lista de empresas para escolher |
| POST | `/api/auth/login/company` | 2º passo do login: escolhe a empresa e recebe os tokens |
| POST | `/api/auth/refresh` | Renova o access token usando o refresh token (cookie httpOnly) |
| POST | `/api/auth/logout` | Revoga o refresh token atual |
| GET | `/api/auth/me` | Dados do usuário + empresa atual da sessão |
| GET | `/api/auth/companies` | Empresas às quais o usuário logado tem acesso |
| GET/POST/PATCH | `/api/users` | Equipe da empresa atual (somente ADMIN cria/edita) |
| GET/POST/PATCH/DELETE | `/api/leads` | Leads/clientes, notas, mensagens, agendamento, histórico |
| GET/PUT | `/api/settings` | Configurações da empresa atual |

Detalhes de payload, claims do token e fluxos de segurança estão em
[`docs/JWT.md`](docs/JWT.md). Payload, resposta e regras de cada rota de
negócio (leads, campanhas, equipe, configurações) estão em
[`docs/API.md`](docs/API.md).

## Documentação interativa (Swagger)

Com o servidor rodando, a documentação da API fica disponível em:

- `http://localhost:3333/docs` — Swagger UI (testável no navegador, com
  suporte a "Authorize" para colar o `accessToken`)
- `http://localhost:3333/docs.json` — o spec OpenAPI puro (JSON)

O spec é mantido em [`src/docs/openapi.ts`](src/docs/openapi.ts); ao
adicionar/alterar uma rota, atualize esse arquivo (e `docs/API.md`) junto.
