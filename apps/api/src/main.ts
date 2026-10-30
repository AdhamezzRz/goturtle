import 'reflect-metadata';
import { config } from './config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, ValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { runMigrations } from './db/migrate';

const log = new Logger('GoTurtle');

/** Configures an app instance (shared by main and e2e tests). */
export function configureApp(app: NestExpressApplication) {
  app.set('trust proxy', 1); // Hostinger / any reverse proxy
  app.disable('x-powered-by');

  const strictCsp = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  const docsCsp = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith('/api/docs') ? docsCsp : strictCsp)(req, res, next));
  app.use(compression());
  app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => ((req as Request & { rawBody?: Buffer }).rawBody = buf) }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  const origins = config.corsOrigins.length ? config.corsOrigins : config.isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
}

function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('GoTurtle Logistics API')
    .setDescription(
      [
        'REST API for the GoTurtle last-mile ERP: orders, pickups, dispatch, heroes, cash, finance, tracking and integrations.',
        '',
        '**Brands / integrations** authenticate with an API key: `X-Api-Key: gt_live_…` (create one in the Brand portal → Developers).',
        '**Portals** authenticate with `Authorization: Bearer <accessToken>` from `POST /api/v1/auth/login`.',
        'Money is always an integer number of **piasters** (`…Cents`, 1 EGP = 100). Times are ISO-8601 UTC.',
        'Webhooks are signed: `X-GoTurtle-Signature: t=<unix>,v1=<hex hmac-sha256(secret, t + "." + body)>`.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'apiKey')
    .build();
  const document = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json', customSiteTitle: 'GoTurtle API' });
}

/** Serves the built portals (apps/web/dist) and falls back to index.html for client-side routes. */
function serveWeb(app: NestExpressApplication) {
  const candidates = [config.webDistDir, resolve(__dirname, '..', '..', 'web', 'dist'), resolve(process.cwd(), 'apps', 'web', 'dist')].filter(Boolean);
  const dist = candidates.find((d) => existsSync(join(d, 'index.html')));
  if (!dist) {
    log.warn('Web build not found (apps/web/dist) — only the API is served. Run `npm run build` at the repo root.');
    return;
  }
  app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  const indexHtml = join(dist, 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  log.log(`Serving portals from ${dist}`);
}

async function bootstrap() {
  if (config.dbAutoMigrate) {
    log.log('Applying database migrations…');
    await runMigrations(config.databaseUrl);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: false });
  configureApp(app);
  setupSwagger(app);
  serveWeb(app);
  await app.listen(config.port, '0.0.0.0');
  log.log(`🐢 GoTurtle is running on port ${config.port} (${config.nodeEnv}) — API docs at /api/docs`);
}

if (require.main === module || process.env.GOTURTLE_AUTOSTART === '1' || require.main?.filename.endsWith('server.js')) {
  bootstrap().catch((err) => {
    log.error('Failed to start', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
