import { NestFactory } from '@nestjs/core';
import { CoreModule } from './modules/core/core.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as cookieParser from 'cookie-parser';
import { corsOptions } from './cors-options';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    CoreModule.forRoot(),
    {
      bufferLogs: true,
      logger: ['fatal', 'error', 'warn', 'log']
    }
  );

  /*
   Example: getting instances to pass as dependencies into class constructors (when needed)
   const reflector = app.get(Reflector);
   const featureService = app.get(FeatureService);
   */

  app.useGlobalPipes(
    new ValidationPipe(
      // This allows to automatically transform the incoming request payloads into DTO instances before validating them
      { transform: true }
    )
  );
  app.use(helmet());
  app.enableCors(corsOptions());
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  app.use(compression());
  app.use(cookieParser()); // this wil allow to get parsed cookie from req.cookies instead of req.get('Cookie')

  if (process.env['ENVIRONMENT'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Swagger')
      .setDescription('Starter Project API')
      .setContact(
        'Alexander Tupavov',
        'https://github.com/tauinbox',
        'tauinbox@gmail.com'
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addServer('/')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('swagger', app, document, {
      swaggerOptions: {},
      customCss: ''
    });
  }

  const port = process.env['APPLICATION_PORT']
    ? Number(process.env['APPLICATION_PORT'])
    : 3000;

  await app.listen(port);
  console.log(`Server started listening on port ${port}`);
}

void bootstrap();
