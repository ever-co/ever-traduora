import { MorganMiddleware } from '@nest-middlewares/morgan';
import { HttpModule, MiddlewareConsumer, Module, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { renderFile } from 'ejs';
import { config } from './config';
import { AuthController } from './controllers/auth.controller';
import { ExportsController } from './controllers/exports.controller';
import HealthController from './controllers/health.controller';
import { ImportController } from './controllers/import.controller';
import IndexController from './controllers/index.controller';
import LocaleController from './controllers/locale.controller';
import ProjectClientController from './controllers/project-client.controller';
import ProjectInviteController from './controllers/project-invite.controller';
import ProjectPlanController from './controllers/project-plan.controller';
import ProjectUserController from './controllers/project-user.controller';
import ProjectController from './controllers/project.controller';
import TagController from './controllers/tags.controller';
import TermController from './controllers/term.controller';
import TranslationController from './controllers/translation.controller';
import UserController from './controllers/user.controller';
import { Invite } from './entity/invite.entity';
import { Locale } from './entity/locale.entity';
import { Plan } from './entity/plan.entity';
import { ProjectClient } from './entity/project-client.entity';
import { ProjectLocale } from './entity/project-locale.entity';
import { ProjectUser } from './entity/project-user.entity';
import { Project } from './entity/project.entity';
import { Tag } from './entity/tag.entity';
import { TermTag } from './entity/term-tag.entity';
import { Term } from './entity/term.entity';
import { TranslationTag } from './entity/translation-tag.entity';
import { Translation } from './entity/translation.entity';
import { User } from './entity/user.entity';
import { CustomExceptionFilter } from './filters/exception.filter';
import { AuthService } from './services/auth.service';
import AuthorizationService from './services/authorization.service';
import { JwtStrategy } from './services/jwt.strategy';
import MailService from './services/mail.service';
import { UserService } from './services/user.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secretOrPrivateKey: config.secret,
      signOptions: {
        expiresIn: config.authTokenExpires,
      },
    }),
    TypeOrmModule.forRoot(config.db.default),
    TypeOrmModule.forFeature([
      User,
      Invite,
      ProjectUser,
      Project,
      Term,
      Locale,
      ProjectLocale,
      Translation,
      ProjectClient,
      Plan,
      Tag,
      TermTag,
      TranslationTag,
    ]),
    HttpModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UserController,
    ProjectController,
    ProjectPlanController,
    ProjectUserController,
    ProjectInviteController,
    TermController,
    TranslationController,
    ImportController,
    ProjectClientController,
    TagController,
    ExportsController,
    LocaleController,
    IndexController,
  ],
  providers: [UserService, AuthService, MailService, JwtStrategy, AuthorizationService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    if (config.accessLogsEnabled) {
      MorganMiddleware.configure('short');
      consumer.apply(MorganMiddleware).forRoutes('*');
    }
  }
}

export const addPipesAndFilters = (app: NestExpressApplication) => {
  app.disable('x-powered-by');

  app.set('etag', false);

  if (config.corsEnabled) {
    app.enableCors({ origin: '*' });
  }

  app.useGlobalFilters(new CustomExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: false,
      disableErrorMessages: true,
      whitelist: true,
    }),
  );

  app.useStaticAssets(config.publicDir, { index: false, redirect: false });

  app.setBaseViewsDir('src/templates');

  app.engine('html', renderFile);
};
