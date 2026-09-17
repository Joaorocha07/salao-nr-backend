import { app } from './app';
import { env } from './config/env';

app.listen(env.PORT, () => {
  console.log(`Espaço NR backend rodando em http://localhost:${env.PORT}`);
});
