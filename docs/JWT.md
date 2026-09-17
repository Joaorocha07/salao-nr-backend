# Autenticação JWT — Espaço NR

Este documento explica como a autenticação funciona: os tipos de token, o
fluxo de login com escolha de empresa, como validar e renovar sessões, e as
decisões de segurança por trás disso.

## Visão geral

O sistema usa **três tipos de token**, todos JWT assinados com HMAC-SHA256
(`HS256`), cada um com seu próprio segredo e finalidade:

| Token | Onde vive | Duração | Finalidade |
| --- | --- | --- | --- |
| **Access token** | Guardado pelo front-end (memória/estado), enviado em `Authorization: Bearer` | 15 min (`JWT_ACCESS_EXPIRES_IN`) | Autoriza chamadas à API |
| **Pré-auth token** | Guardado temporariamente pelo front-end entre a tela de login e a tela de escolha de empresa | 5 min (`JWT_PREAUTH_EXPIRES_IN`) | Prova que a senha já foi validada, sem ainda conceder acesso a dados |
| **Refresh token** | Cookie `httpOnly` (`nr_refresh_token`), nunca acessível via JavaScript | 30 dias (`JWT_REFRESH_EXPIRES_IN`) | Gera novos access tokens sem pedir senha de novo |

O access token e o pré-auth token são JWT "de verdade" (você pode
decodificá-los, mas não forjá-los sem o segredo). O refresh token é
**opaco**: uma string aleatória de 96 caracteres hex. O banco guarda apenas
o hash SHA-256 dela — se o banco vazar, os refresh tokens não podem ser
reutilizados diretamente.

## Por que um token de "pré-autenticação"?

A regra de negócio é: a mesma conta pode ter acesso a **duas empresas**
(ex.: duas unidades do salão), e a pessoa escolhe em qual delas quer
trabalhar depois de entrar com e-mail e senha — sem digitar a senha de novo
para trocar de empresa dentro da mesma sessão de login.

Isso significa que a validação de credenciais e a concessão de acesso a
dados de uma empresa específica são dois passos distintos. O pré-auth token
representa "eu sei que é essa pessoa" sem ainda dizer "e ela pode ver os
dados da empresa X" — por isso ele não carrega `companyId` nem `role`, tem
vida curta (5 min) e **não é aceito pelo middleware de autenticação** das
rotas de negócio (`authenticate` rejeita qualquer token cujo `type` não seja
`"access"`).

## Claims dos tokens

### Access token

```json
{
  "type": "access",
  "sub": "<userId>",
  "companyId": "<companyId>",
  "role": "ADMIN" | "EMPLOYEE",
  "iat": 1234567890,
  "exp": 1234568790
}
```

`companyId` e `role` ficam **dentro do token**, assinados — o cliente não
pode trocar de empresa só editando uma variável local. Toda rota de negócio
lê `req.auth.companyId` (preenchido pelo middleware a partir do token) para
filtrar os dados; nunca confia em um `companyId` vindo do corpo da
requisição.

### Pré-auth token

```json
{ "type": "pre-auth", "sub": "<userId>", "iat": ..., "exp": ... }
```

### Refresh token

Não é um JWT — é `crypto.randomBytes(48).toString('hex')`. O que existe no
banco (tabela `refresh_tokens`) é:

```
id, userId, companyId, tokenHash (sha256), expiresAt, revokedAt,
replacedByTokenHash, createdAt
```

## Fluxo de login (passo a passo)

```
1. POST /api/auth/login { email, password }
   └─ credenciais inválidas?           → 401
   └─ usuário tem 1 empresa ativa?     → 200 { accessToken, user, company, role }
                                          + cookie refresh_token
   └─ usuário tem 2+ empresas ativas?  → 200 { status: "select-company",
                                                preAuthToken,
                                                companies: [{id,name,slug,role}, ...] }

2. (somente se houve escolha) POST /api/auth/login/company
   { preAuthToken, companyId }
   └─ verifica assinatura/expiração do preAuthToken
   └─ verifica que o usuário tem CompanyMembership ativo naquela empresa
   └─ 200 { accessToken, user, company, role } + cookie refresh_token
```

No front-end, isso mapeia direto para a tela de login: se a resposta do
passo 1 vier com `status: "select-company"`, mostra-se um seletor com as
`companies` retornadas antes de liberar o dashboard.

## Usando o access token

Toda rota de negócio (`/api/leads`, `/api/users`, `/api/campaigns`,
`/api/settings`, `/api/auth/me`, `/api/auth/companies`) exige:

```
Authorization: Bearer <accessToken>
```

O middleware `authenticate` (`src/middlewares/auth.middleware.ts`):

1. Extrai o token do header `Authorization`.
2. Verifica assinatura e expiração com `JWT_ACCESS_SECRET`.
3. Rejeita se `type !== "access"` (impede usar um pré-auth token aqui).
4. Preenche `req.auth = { userId, companyId, role }`.

Rotas que exigem perfil administrador usam `requireRole('ADMIN')` (ex.:
criar/editar membros da equipe, alterar configurações da empresa).

## Renovando a sessão (refresh)

```
POST /api/auth/refresh
```

O refresh token é lido do cookie `httpOnly` `nr_refresh_token` (ou do campo
`refreshToken` no corpo, se o cliente não usar cookies — por exemplo um app
mobile). O servidor:

1. Calcula o hash SHA-256 do token recebido e busca no banco.
2. Rejeita se não existir, estiver revogado ou expirado.
3. Confirma que o vínculo `CompanyMembership` daquele usuário com aquela
   empresa continua ativo (permite revogar acesso instantaneamente).
4. **Rotaciona**: marca o token atual como revogado (`revokedAt`), grava
   qual token o substituiu (`replacedByTokenHash`) e cria um novo refresh
   token.
5. Emite um novo access token e devolve o novo refresh token no cookie.

**Rotação com detecção de reuso**: como cada refresh token só pode ser
usado uma vez, se um token revogado for apresentado de novo (sinal de que
foi roubado e usado por duas partes), a tentativa falha com 401. Uma
extensão natural — não implementada aqui para manter o escopo enxuto —
seria, ao detectar esse reuso, revogar automaticamente toda a cadeia de
tokens daquele usuário.

## Logout e revogação

```
POST /api/auth/logout
```

Revoga (marca `revokedAt`) o refresh token atual e limpa o cookie. O access
token em si não é invalidado no servidor (é stateless) — por isso sua vida
é curta (15 min): mesmo que alguém capture um access token, ele expira
rápido e não pode ser renovado sem um refresh token válido.

`POST /api/auth/change-password` e o fluxo de recuperação
(`/api/auth/forgot-password` + `/api/auth/reset-password`) revogam **todos**
os refresh tokens do usuário, encerrando qualquer sessão ativa em outros
dispositivos.

## Decisões de segurança

- **Segredos separados** para access, refresh (implícito, via hash) e
  pré-auth: um token de um tipo nunca pode ser reaproveitado como outro,
  mesmo que alguém tente adulterar o campo `type` (a assinatura não bateria
  com o segredo errado).
- **Sem `companyId`/`role` vindos do cliente**: qualquer decisão de acesso a
  dados usa exclusivamente o que está assinado no access token.
- **Senhas com `bcryptjs`**, 12 rounds de salt.
- **Rate limiting** nas rotas de autenticação (`authRateLimiter`: 20
  requisições / 15 min por IP) para dificultar força bruta.
- **Refresh token em cookie `httpOnly` + `sameSite=lax`**, então não é
  legível por JavaScript no navegador (mitiga XSS) nem enviado em
  navegação cross-site de terceiros.
- **Mensagens de erro genéricas** em login e recuperação de senha
  (`E-mail ou senha inválidos`, sempre 200 em "esqueci minha senha") para
  não revelar quais e-mails existem na base.
- **`COOKIE_SECURE=true`** deve ser configurado em produção (HTTPS
  obrigatório) — no `.env.example` fica `false` só para permitir teste local
  em `http://localhost`.

## Exemplo completo (curl)

```bash
# 1) login
curl -c cookies.txt -s -X POST http://localhost:3333/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"contato@espaconr.com.br","password":"MudeEstaSenha123"}'
# -> se tiver 2 empresas: {"status":"select-company","preAuthToken":"...","companies":[...]}

# 2) escolher empresa
curl -c cookies.txt -s -X POST http://localhost:3333/api/auth/login/company \
  -H 'Content-Type: application/json' \
  -d '{"preAuthToken":"<preAuthToken>","companyId":"<companyId>"}'
# -> {"accessToken":"...", "user":{...}, "company":{...}, "role":"ADMIN"}

# 3) chamar uma rota protegida
curl -s http://localhost:3333/api/leads \
  -H "Authorization: Bearer <accessToken>"

# 4) renovar quando o access token expirar (usa o cookie salvo)
curl -b cookies.txt -c cookies.txt -s -X POST http://localhost:3333/api/auth/refresh

# 5) logout
curl -b cookies.txt -s -X POST http://localhost:3333/api/auth/logout
```
