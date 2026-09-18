// Catálogo de telas do app que podem ser liberadas/restritas por funcionário.
// Administradores sempre têm acesso a todas, independente deste catálogo.
export const SCREENS = [
  'dashboard',
  'leads',
  'agenda',
  'historico',
  'clientes',
  'empresas',
  'whatsapp',
  'configuracoes',
] as const;

export type Screen = (typeof SCREENS)[number];
