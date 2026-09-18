// Spec OpenAPI servida em /docs (swagger-ui-express). Mantida à mão, em
// sincronia com docs/API.md e docs/JWT.md — ao mudar uma rota/schema,
// atualize aqui também.

const errorResponse = {
  description: 'Erro padrão da API',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Dados inválidos.' },
              details: { type: 'object', nullable: true },
            },
          },
        },
      },
    },
  },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Espaço NR CRM — API',
    version: '1.0.0',
    description:
      'API do Espaço NR CRM. Autenticação JWT própria com múltiplas empresas por usuário. ' +
      'Veja também docs/JWT.md (fluxo completo de autenticação) e docs/API.md (referência em Markdown).',
  },
  servers: [{ url: '/api', description: 'Prefixo de todas as rotas abaixo (ex.: http://localhost:3333/api)' }],
  tags: [
    { name: 'Auth', description: 'Registro, login em 2 etapas, refresh, senha' },
    { name: 'Users', description: 'Equipe (membros) da empresa atual' },
    { name: 'Leads', description: 'CRM: leads, notas, mensagens, agendamento, histórico' },
    { name: 'Settings', description: 'Configurações da empresa atual' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token obtido em /auth/login ou /auth/login/company. Veja docs/JWT.md.',
      },
    },
    schemas: {
      Lead: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          phone: { type: 'string' },
          gender: { type: 'string', nullable: true },
          birthday: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['NOVO_LEAD', 'AGENDADO', 'FECHADO', 'NAO_FECHOU', 'ANTIGO'] },
          interests: { type: 'array', items: { type: 'string' } },
          date: { type: 'string' },
          activityDate: { type: 'string', nullable: true },
          appointmentDate: { type: 'string', nullable: true },
          appointmentTime: { type: 'string', nullable: true },
          notes: { type: 'array', items: { $ref: '#/components/schemas/LeadNote' } },
          messages: { type: 'array', items: { $ref: '#/components/schemas/LeadMessage' } },
          history: { type: 'array', items: { $ref: '#/components/schemas/ServiceRecord' } },
        },
      },
      LeadNote: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, text: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
      },
      LeadMessage: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          text: { type: 'string' },
          own: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ServiceRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          service: { type: 'string' },
          date: { type: 'string' },
          time: { type: 'string', nullable: true },
        },
      },
      CompanySettings: {
        type: 'object',
        properties: {
          companyId: { type: 'string', format: 'uuid' },
          salonName: { type: 'string' },
          ownerName: { type: 'string' },
          email: { type: 'string' },
          greetingMessage: { type: 'string' },
          autoOldLeadDays: { type: 'integer' },
          whatsappConnected: { type: 'boolean' },
          captureConversations: { type: 'boolean' },
          captureName: { type: 'boolean' },
          capturePhone: { type: 'boolean' },
          autoCreateLead: { type: 'boolean' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', description: 'membershipId' },
          role: { type: 'string', enum: ['ADMIN', 'EMPLOYEE'] },
          active: { type: 'boolean' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
      Company: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          role: { type: 'string', enum: ['ADMIN', 'EMPLOYEE'] },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Cria a 1ª empresa + usuário administrador',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['companyName', 'name', 'email', 'password'],
                properties: {
                  companyName: { type: 'string', minLength: 2 },
                  name: { type: 'string', minLength: 2 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
              example: { companyName: 'Espaço NR', name: 'Nara Rocha', email: 'contato@espaconr.com.br', password: 'MudeEstaSenha123' },
            },
          },
        },
        responses: { '201': { description: 'Empresa e usuário criados; tokens emitidos (mesmo formato do login)' }, '400': errorResponse },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login com e-mail/senha (passo 1)',
        description:
          'Se o usuário tiver acesso a uma única empresa, já retorna a sessão completa. Se tiver 2+, retorna `status: "select-company"` e um `preAuthToken` para o passo 2.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
              },
              example: { email: 'contato@espaconr.com.br', password: 'MudeEstaSenha123' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Sessão completa OU necessidade de escolher empresa',
            content: {
              'application/json': {
                examples: {
                  sessaoCompleta: {
                    value: { accessToken: '<jwt>', user: { id: '...', name: '...', email: '...' }, company: { id: '...', name: '...' }, role: 'ADMIN' },
                  },
                  escolherEmpresa: {
                    value: { status: 'select-company', preAuthToken: '<jwt>', companies: [{ id: '...', name: '...', slug: '...', role: 'ADMIN' }] },
                  },
                },
              },
            },
          },
          '401': errorResponse,
        },
      },
    },
    '/auth/login/company': {
      post: {
        tags: ['Auth'],
        summary: '2º passo do login: escolhe a empresa e recebe os tokens',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['preAuthToken', 'companyId'],
                properties: { preAuthToken: { type: 'string' }, companyId: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Sessão completa (accessToken + cookie de refresh)' }, '401': errorResponse },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Renova o access token usando o refresh token (cookie httpOnly, com rotação)',
        security: [],
        responses: { '200': { description: 'Novo accessToken + novo cookie de refresh' }, '401': errorResponse },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Revoga o refresh token atual e limpa o cookie', security: [], responses: { '204': { description: 'Sem conteúdo' } } },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Inicia recuperação de senha (sempre responde 200, mesmo se o e-mail não existir)',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string', format: 'email' } } } } } },
        responses: { '200': { description: 'OK (genérico, não revela se o e-mail existe)' } },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Conclui a recuperação de senha com o token enviado por e-mail',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } } },
            },
          },
        },
        responses: { '200': { description: 'Senha alterada; todos os refresh tokens do usuário revogados' }, '400': errorResponse },
      },
    },
    '/auth/me': {
      get: { tags: ['Auth'], summary: 'Dados do usuário + empresa atual da sessão', responses: { '200': { description: 'Usuário e empresa atuais' }, '401': errorResponse } },
    },
    '/auth/companies': {
      get: {
        tags: ['Auth'],
        summary: 'Empresas às quais o usuário logado tem acesso',
        responses: {
          '200': { content: { 'application/json': { schema: { type: 'object', properties: { companies: { type: 'array', items: { $ref: '#/components/schemas/Company' } } } } } } },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Troca a senha do usuário logado (revoga todos os refresh tokens)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } },
              },
            },
          },
        },
        responses: { '200': { description: 'Senha alterada' }, '400': errorResponse, '401': errorResponse },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'Lista a equipe (membros) da empresa atual',
        responses: {
          '200': { content: { 'application/json': { schema: { type: 'object', properties: { members: { type: 'array', items: { $ref: '#/components/schemas/Member' } } } } } } },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Adiciona um membro à empresa atual (ADMIN)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                  name: { type: 'string', minLength: 2 },
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['ADMIN', 'EMPLOYEE'], default: 'EMPLOYEE' },
                  password: { type: 'string', minLength: 8, description: 'Obrigatório se o e-mail ainda não existir como usuário no sistema' },
                },
              },
            },
          },
        },
        responses: { '201': { content: { 'application/json': { schema: { type: 'object', properties: { member: { $ref: '#/components/schemas/Member' } } } } } }, '403': errorResponse, '400': errorResponse },
      },
    },
    '/users/{membershipId}': {
      patch: {
        tags: ['Users'],
        summary: 'Atualiza um membro da empresa atual (ADMIN)',
        parameters: [{ name: 'membershipId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string', enum: ['ADMIN', 'EMPLOYEE'] }, active: { type: 'boolean' } } },
            },
          },
        },
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { member: { $ref: '#/components/schemas/Member' } } } } } }, '403': errorResponse, '404': errorResponse },
      },
    },
    '/leads': {
      get: {
        tags: ['Leads'],
        summary: 'Lista os leads da empresa atual',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['NOVO_LEAD', 'AGENDADO', 'FECHADO', 'NAO_FECHOU', 'ANTIGO'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', example: '2025-01-01' } },
          { name: 'to', in: 'query', schema: { type: 'string', example: '2025-12-31' } },
        ],
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { leads: { type: 'array', items: { $ref: '#/components/schemas/Lead' } } } } } } } },
      },
      post: {
        tags: ['Leads'],
        summary: 'Cria um lead',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'phone', 'interests'],
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string', minLength: 8 },
                  gender: { type: 'string' },
                  interests: { type: 'array', items: { type: 'string' }, minItems: 1 },
                  status: { type: 'string', enum: ['NOVO_LEAD', 'AGENDADO', 'FECHADO', 'NAO_FECHOU', 'ANTIGO'], default: 'NOVO_LEAD' },
                },
              },
              example: { name: 'Maria Silva', phone: '11999998888', interests: ['corte', 'coloração'] },
            },
          },
        },
        responses: { '201': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } }, '400': errorResponse },
      },
    },
    '/leads/history': {
      get: {
        tags: ['Leads'],
        summary: 'Histórico de atendimentos de todos os leads da empresa',
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { records: { type: 'array', items: { $ref: '#/components/schemas/ServiceRecord' } } } } } } } },
      },
    },
    '/leads/{id}': {
      get: {
        tags: ['Leads'],
        summary: 'Busca um lead pelo id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } }, '404': errorResponse },
      },
      patch: {
        tags: ['Leads'],
        summary: 'Atualiza campos do lead (todos opcionais)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  gender: { type: 'string' },
                  birthday: { type: 'string' },
                  interests: { type: 'array', items: { type: 'string' } },
                  status: { type: 'string', enum: ['NOVO_LEAD', 'AGENDADO', 'FECHADO', 'NAO_FECHOU', 'ANTIGO'] },
                },
              },
            },
          },
        },
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } }, '404': errorResponse },
      },
      delete: {
        tags: ['Leads'],
        summary: 'Remove um lead',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '204': { description: 'Sem conteúdo' }, '404': errorResponse },
      },
    },
    '/leads/{id}/schedule': {
      post: {
        tags: ['Leads'],
        summary: 'Agenda (ou reagenda) um atendimento para o lead',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['date', 'time'], properties: { date: { type: 'string', example: '2025-03-20' }, time: { type: 'string', example: '14:30' } } },
            },
          },
        },
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } }, '400': errorResponse },
      },
    },
    '/leads/{id}/cancel-appointment': {
      post: {
        tags: ['Leads'],
        summary: 'Cancela o agendamento atual do lead',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } } },
      },
    },
    '/leads/{id}/notes': {
      post: {
        tags: ['Leads'],
        summary: 'Adiciona uma observação ao lead',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } } } },
        responses: { '201': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } } },
      },
    },
    '/leads/{id}/messages': {
      post: {
        tags: ['Leads'],
        summary: 'Registra uma mensagem na conversa do lead',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, own: { type: 'boolean', default: false } } },
            },
          },
        },
        responses: { '201': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } } },
      },
    },
    '/leads/{id}/history/{recordId}': {
      delete: {
        tags: ['Leads'],
        summary: 'Remove um registro do histórico de atendimentos do lead',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'recordId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { lead: { $ref: '#/components/schemas/Lead' } } } } } }, '404': errorResponse },
      },
    },
    '/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Obtém as configurações da empresa atual',
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { settings: { $ref: '#/components/schemas/CompanySettings' } } } } } } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Atualiza as configurações da empresa atual (ADMIN)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  salonName: { type: 'string' },
                  ownerName: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  greetingMessage: { type: 'string' },
                  autoOldLeadDays: { type: 'integer', minimum: 1 },
                  whatsappConnected: { type: 'boolean' },
                  captureConversations: { type: 'boolean' },
                  captureName: { type: 'boolean' },
                  capturePhone: { type: 'boolean' },
                  autoCreateLead: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { settings: { $ref: '#/components/schemas/CompanySettings' } } } } } }, '403': errorResponse },
      },
    },
  },
};
