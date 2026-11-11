# Executando a Fase 03

Pré-requisitos: Docker + Compose v2, portas 3000/5432/8025/9000/9001 livres e pelo menos 35GiB de disco temporário por job ativo. Não há interface de vídeos nesta fase.

```bash
cd nestjs-project
cp .env.example .env
# Ajuste S3_PUBLIC_ENDPOINT para o endereço do storage alcançável pelo cliente.
docker compose up -d --build
docker compose ps
docker compose logs -f worker
```

MinIO e mc são compilados a partir das fontes oficiais e tags fixas pelo `docker/Dockerfile.minio`, porque os registros históricos de imagens deixaram de estar acessíveis. A primeira compilação precisa baixar os módulos Go e pode levar alguns minutos.

A API aplica migrations antes de servir; o worker espera a API saudável. O bucket é privado e o init configura expiração de multipart incompleto. Redis persiste AOF. Credenciais do exemplo destinam-se ao desenvolvimento; use credenciais e TLS próprios no deploy. `storage-init` terminar com exit 0 é esperado.

Entre containers use `db`, `storage`, `queue` e `mailpit`. Apenas `S3_PUBLIC_ENDPOINT` usa o hostname acessível ao cliente (por exemplo `http://localhost:9000` em desenvolvimento). Nunca substitua o hostname de uma URL já assinada. Em testes feitos dentro do container use `S3_PUBLIC_ENDPOINT=http://storage:9000` no `.env` e recrie os containers. A origem do navegador está em `UPLOAD_ALLOWED_ORIGIN`.

## Fluxo de upload

1. Cadastre, confirme e faça login pelos endpoints da Fase 02; obtenha `access_token`.
2. `POST /videos/uploads` com JWT e JSON `{"title":"Meu vídeo","size":123456,"content_type":"video/mp4"}`. Receba `id`, `public_id`, `part_size`, `part_count`, `expires_at`.
3. Divida o arquivo em partes de `part_size` (64MiB). Para cada parte, peça `POST /videos/{id}/upload-parts/{n}` com JWT e envie a parte com `PUT` diretamente à URL retornada. A última parte tem os bytes restantes. Não envie JWT ao storage. Renove URLs após 15 minutos; a sessão dura 24h.
4. `POST /videos/{id}/complete` com JWT, sem ETags/body. A API confere as partes no storage, finaliza e grava `processing`. Chamada repetida é idempotente. O worker despacha em até aproximadamente 5s quando saudável.
5. Consulte `GET /videos/{id}/status` com JWT até `ready` ou `error`.
6. `GET /videos/{public_id}` é a URL estável pública. `/stream`, `/download` e `/thumbnail` respondem 307 para URLs assinadas por 15 minutos. Refaça a chamada ao endpoint estável quando expirarem. O player segue o redirect; byte ranges são atendidos pelo storage com 206, e ranges inválidos com 416. Download é o MP4 processado, com attachment.
7. Para desistir enquanto rascunho: `DELETE /videos/{id}/upload`. Sessões expiradas são canceladas pelo worker. Um source já finalizado no S3 após falha no commit pode ser recuperado por nova chamada complete ou pela reconciliação após expirar. Não existe retry manual de processamento nesta fase.

MP4, WebM, QuickTime e Matroska são aceitos no cadastro; FFmpeg verifica o conteúdo real. Conteúdo inválido termina em `error` depois de três tentativas. O original não é publicado. O worker converte para H.264/AAC, MP4 faststart, e gera JPEG. Esta fase não oferece HLS/adaptive bitrate.

## Verificação completa

Use ambiente de teste isolado: as suites existentes limpam o banco e as filas. Não execute contra dados de uso real. Pare o worker independente durante os testes: os e2e iniciam seu próprio consumidor real.

```bash
docker compose stop worker
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run migration:run
docker compose exec nestjs-api npm run test:e2e -- --runInBand
docker compose exec nestjs-api npx tsc --noEmit
docker compose exec nestjs-api npm run lint
docker compose exec nestjs-api npm run build
docker compose up -d worker
```

O workflow `Backend videos` executa esses checks em containers. Testes abrangem DB/migration, storage multipart/ranges/attachment, Redis com retry/deduplicação, HTTP com JWT de dono/outro dono, FFmpeg real para arquivo válido/corrompido e geração real de mídia. O limite exato de 10GiB é exercitado no DTO/banco/cadastro; transferência completa de 10GiB é um teste de capacidade separado, não alegado pelos testes pequenos.

Para exercitar uma transferência real de até 10GiB forneça um vídeo local ao utilitário:

```bash
# Execute no container, com o arquivo montado em /media/large.mp4 e JWT válido.
docker compose exec -e VIDEO_TOKEN="$VIDEO_TOKEN" -e VIDEO_REFRESH_TOKEN="$VIDEO_REFRESH_TOKEN" nestjs-api \
  npx ts-node scripts/upload-video.ts /media/large.mp4
```

Defina os dois tokens retornados pelo login, pois uma transferência grande pode exceder os 15 minutos do access token; o utilitário renova a sessão ao receber 401. O utilitário lê uma parte por vez, envia diretamente ao storage e espera processamento. Registre tamanho exato, duração, resultado, pico de RSS e disco do worker para sua evidência de capacidade. Não confunda teste de contrato do limite com transferência integral.

## Operação e recuperação

`processing` no PostgreSQL é a intenção durável de despacho. O worker reconcilia com Redis a cada 5s. Job ID é UUID de vídeo; duplicatas prontas são no-op. Tentativas: 3, backoff exponencial 5s. Um job permanentemente falho (inclusive stalled) torna-se `error` na reconciliação. Erros expostos ao dono são códigos genéricos; URLs, credenciais e stderr dos vídeos não são publicados.

Redis usa `noeviction`; monitore uso de memória e disco/AOF. Jobs completos/falhos ficam retidos para deduplicação; não há limpeza automática de histórico nesta fase. Se Redis perder dados, o worker recria jobs para linhas processing. Se ocorrer retry após gravar objetos mas antes de gravar ready, as mesmas chaves são sobrescritas. O worker tem concorrência 1; não aumente réplicas sem dimensionar CPU/disco. Arquivos temporários são removidos no finally; um SIGKILL pode deixar resíduos no volume, que precisam de limpeza operacional com o worker parado. Uploads cancelados/expirados abortam multipart; objetos de vídeos falhos permanecem privados para diagnóstico e precisam de política de retenção operacional.

Para produção, limite quotas do storage: URLs assinadas não impedem que um cliente envie bytes excessivos antes da conferência de conclusão. Configure TLS, credenciais restritas ao bucket e disco dedicado para o worker. A API rejeita conteúdo total divergente e não o publica/processa.
