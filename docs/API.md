# API — Referência de endpoints

Referência dos endpoints de negócio: payload de entrada, resposta e regras
de cada rota. Autenticação (login, tokens, refresh) está em
[`docs/JWT.md`](JWT.md) — aqui assume-se que você já tem um `accessToken`
válido.

Convenções gerais:

- Base URL local: `http://localhost:3333`.
- Toda rota abaixo exige `Authorization: Bearer <accessToken>`.
- Rotas marcadas **ADMIN** só funcionam se `role` do token for `ADMIN`
  (`requireRole('ADMIN')`); caso contrário respondem `403`.
- Todo dado é implicitamente filtrado pela empresa do token
  (`req.auth.companyId`) — não existe parâmetro de `companyId` no corpo ou
  na query para as rotas de negócio.
- Corpo de erro padrão (`error.middleware.ts`):
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "Dados inválidos.", "details": { } } }
  ```
  Códigos comuns: `VALIDATION_ERROR` (400, corpo/query fora do schema Zod),
  `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
  `INTERNAL_ERROR` (500).

## Leads (`/api/leads`)

Modelo (`prisma/schema.prisma`): `id, name, phone, gender?, birthday?,
status, interests[], date, activityDate?, appointmentDate?,
appointmentTime?`, mais `notes[]`, `messages[]` e `history[]`
(`ServiceRecord`) relacionados.

`status` é um dos valores de `LeadStatus`: `NOVO_LEAD`, `AGENDADO`,
`FECHADO`, `NAO_FECHOU`, `ANTIGO`.

### `GET /api/leads`

Lista os leads da empresa. Query string opcional (`listLeadsQuerySchema`):

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `status` | `LeadStatus` | Filtra por status |
| `search` | `string` | Busca (nome/telefone, conforme `leads.service.ts`) |
| `from` | `YYYY-MM-DD` | Data inicial |
| `to` | `YYYY-MM-DD` | Data final |

Resposta: `200 { "leads": Lead[] }`.

### `GET /api/leads/history`

Histórico de atendimentos (`ServiceRecord`) de todos os leads da empresa.

Resposta: `200 { "records": ServiceRecord[] }`.

### `GET /api/leads/:id`

Resposta: `200 { "lead": Lead }` ou `404` se o lead não existir/não for da
empresa do token.

### `POST /api/leads`

Corpo (`createLeadSchema`):

```json
{
  "name": "Maria Silva",
  "phone": "11999998888",
  "gender": "feminino",
  "interests": ["corte", "coloração"],
  "status": "NOVO_LEAD"
}
```

- `name`, `phone`: obrigatórios.
- `interests`: array com pelo menos 1 item.
- `status`: opcional, default `NOVO_LEAD`.
- `gender`: opcional.

Resposta: `201 { "lead": Lead }`.

### `PATCH /api/leads/:id`

Corpo (`updateLeadSchema`) — todos os campos opcionais: `name`, `phone`,
`gender`, `birthday`, `interests`, `status`. Envie somente os campos que
quer alterar.

Resposta: `200 { "lead": Lead }`.

### `DELETE /api/leads/:id`

Resposta: `204` sem corpo.

### `POST /api/leads/:id/schedule`

Agenda (ou reagenda) um atendimento para o lead. Corpo
(`scheduleAppointmentSchema`):

```json
{ "date": "2025-03-20", "time": "14:30" }
```

Resposta: `200 { "lead": Lead }` com `appointmentDate`/`appointmentTime`
preenchidos.

### `POST /api/leads/:id/cancel-appointment`

Sem corpo. Limpa `appointmentDate`/`appointmentTime` do lead.

Resposta: `200 { "lead": Lead }`.

### `POST /api/leads/:id/notes`

Corpo (`addNoteSchema`):

```json
{ "text": "Cliente prefere atendimento à tarde." }
```

Resposta: `201 { "lead": Lead }` (lead retornado já inclui a nova nota em
`notes`).

### `POST /api/leads/:id/messages`

Registra uma mensagem na conversa do lead (histórico de WhatsApp, por
exemplo). Corpo (`addMessageSchema`):

```json
{ "text": "Oi! Posso agendar para sexta?", "own": false }
```

- `own`: `true` se a mensagem foi enviada pela empresa, `false` (default)
  se foi o cliente.

Resposta: `201 { "lead": Lead }`.

### `DELETE /api/leads/:id/history/:recordId`

Remove um registro específico do histórico de atendimentos (`ServiceRecord`)
do lead.

Resposta: `200 { "lead": Lead }`.

## Campanhas (`/api/campaigns`)

Modelo: `id, name, date, message, mediaUrl?, recipientCount`.

### `GET /api/campaigns`

Resposta: `200 { "campaigns": Campaign[] }`.

### `POST /api/campaigns`

Corpo (`createCampaignSchema`):

```json
{
  "name": "Promoção de aniversário",
  "message": "Parabéns! Ganhe 20% de desconto este mês.",
  "mediaUrl": "https://exemplo.com/banner.png",
  "recipientIds": ["<leadId1>", "<leadId2>"]
}
```

- `recipientIds`: UUIDs de leads, pelo menos 1. `recipientCount` é derivado
  do tamanho da lista (a campanha não guarda a lista de destinatários,
  apenas a contagem — ver `campaigns.service.ts`).
- `mediaUrl`: opcional, precisa ser uma URL válida quando enviado.

Resposta: `201 { "campaign": Campaign }`.

### `DELETE /api/campaigns/:id`

Resposta: `204` sem corpo.

## Configurações (`/api/settings`)

Configuração é 1:1 por empresa (`CompanySettings`, chave primária
`companyId`) — não há lista, apenas "a configuração da empresa atual".

### `GET /api/settings`

Resposta: `200 { "settings": CompanySettings }`. Se a empresa nunca
configurou nada, o serviço cria/retorna os defaults do schema (`salonName:
""`, `autoOldLeadDays: 30`, `captureConversations: true`, etc. — ver
`prisma/schema.prisma`).

### `PUT /api/settings` — **ADMIN**

Corpo (`updateSettingsSchema`), todos os campos opcionais (envie só o que
quer mudar):

```json
{
  "salonName": "Espaço NR — Unidade Centro",
  "ownerName": "Nara Rocha",
  "email": "contato@espaconr.com.br",
  "greetingMessage": "Olá! Como posso ajudar?",
  "autoOldLeadDays": 45,
  "whatsappConnected": true,
  "captureConversations": true,
  "captureName": true,
  "capturePhone": true,
  "autoCreateLead": true
}
```

Resposta: `200 { "settings": CompanySettings }`. `403` se quem chamar não
for `ADMIN` na empresa atual.

## Equipe (`/api/users`)

Representa `CompanyMembership` (vínculo usuário↔empresa), não a tabela
`User` diretamente — por isso as rotas usam `membershipId`, e é possível
que a mesma pessoa apareça como membro em duas empresas com registros
diferentes.

### `GET /api/users`

Lista os membros (`CompanyMembership` + dados do `User`) da empresa atual.

Resposta: `200 { "members": Member[] }`.

### `POST /api/users` — **ADMIN**

Corpo (`createUserSchema`):

```json
{
  "name": "Ana Souza",
  "email": "ana@exemplo.com",
  "role": "EMPLOYEE",
  "password": "SenhaTemporaria123"
}
```

- `role`: `ADMIN` ou `EMPLOYEE`, default `EMPLOYEE`.
- `password`: opcional — se o e-mail já existir como `User` no sistema
  (de outra empresa), o vínculo é criado sem exigir senha nova; se for um
  usuário novo, a senha é obrigatória para criar a conta (ver
  `users.service.ts`).

Resposta: `201 { "member": Member }`.

### `PATCH /api/users/:membershipId` — **ADMIN**

Corpo (`updateUserSchema`), todos os campos opcionais: `name`, `role`,
`active`. Usar `active: false` é como "desativar" o acesso do membro àquela
empresa sem apagar o histórico dele.

Resposta: `200 { "member": Member }`.

## Variáveis de ambiente relevantes

Além do que já está em `.env.example` e descrito no README, o app valida
tudo via `src/config/env.ts` (Zod) — se algo estiver ausente ou fora do
formato esperado, o processo falha ao iniciar com a lista de campos
inválidos no console. Principais:

| Variável | Default | Uso |
| --- | --- | --- |
| `PORT` | `3333` | Porta HTTP |
| `NODE_ENV` | `development` | Habilita `debug` nas respostas 500 fora de `production` |
| `CORS_ORIGIN` | `http://localhost:3000` | Origem liberada pelo CORS |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Duração do access token |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Duração do refresh token |
| `JWT_PREAUTH_EXPIRES_IN` | `5m` | Duração do pré-auth token |
| `REFRESH_COOKIE_NAME` | `nr_refresh_token` | Nome do cookie do refresh token |
| `COOKIE_SECURE` | `false` | Deve ser `true` em produção (HTTPS) |
