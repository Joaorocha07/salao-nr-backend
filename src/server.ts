import { app } from './app';
import { env } from './config/env';
import { loadCloudConfigs } from './modules/whatsapp/whatsapp.cloud';
import { restoreConnections } from './modules/whatsapp/whatsapp.connection';
import { startWhatsAppJobs } from './modules/whatsapp/whatsapp.jobs';

app.listen(env.PORT, () => {
  console.log(`Espaço NR backend rodando em http://localhost:${env.PORT}`);
  if (env.WHATSAPP_ENABLED) {
    restoreConnections().catch((err) => console.error('Falha ao reconectar o WhatsApp:', err));
    loadCloudConfigs().catch((err) => console.error('Falha ao carregar a API oficial do WhatsApp:', err));
    startWhatsAppJobs();
  }
});
