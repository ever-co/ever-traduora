import { MorganMiddleware, SAFE_SHORT_FORMAT } from './middlewares/morgan-middleware';
import { MiddlewareConsumer, Module, ValidationPipe } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { renderFile } from 'ejs';
import { config } from './config';
import { AuthController } from './controllers/auth.controller';
import { ExportsController } from './controllers/exports.controller';
import HealthController from './controllers/health.controller';
import { ImportController } from './controllers/import.controller';
import IndexController, { redirectTaggedIndexFile } from './controllers/index.controller';
import LocaleController from './controllers/locale.controller';
import ProjectActivityController from './controllers/project-activity.controller';
import ProjectClientController from './controllers/project-client.controller';
import ProjectInviteController from './controllers/project-invite.controller';
import ProjectPlanController from './controllers/project-plan.controller';
import ProjectLabelController from './controllers/project-label.controller';
import ProjectUserController from './controllers/project-user.controller';
import ProjectController from './controllers/project.controller';
import OrganizationController from './controllers/organization.controller';
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
import { Label } from './entity/label.entity';
import { Term } from './entity/term.entity';
import { Translation } from './entity/translation.entity';
import { TranslationHistory } from './entity/translation-history.entity';
import { User } from './entity/user.entity';
import { Organization } from './entity/organization.entity';
import { OrganizationInvite } from './entity/organization-invite.entity';
import { OrganizationUser } from './entity/organization-user.entity';
import { UserIdentity } from './entity/user-identity.entity';
import { EverIdSession } from './entity/ever-id-session.entity';
import { EverIdLogoutJti } from './entity/ever-id-logout-jti.entity';
import { CustomExceptionFilter } from './filters/exception.filter';
import { AuthService } from './services/auth.service';
import AuthorizationService from './services/authorization.service';
import { JwtStrategy } from './services/jwt.strategy';
import MailService from './services/mail.service';
import { UserService } from './services/user.service';
import { OidcProviderService } from './services/oidc-provider.service';
import { EverIdSessionService } from './services/ever-id-session.service';
import { OrganizationService } from './services/organization/organization.service';
import { OrganizationScopedProjects } from './services/organization/organization-scoped-projects.service';
import { AccessGuard } from './access/access.guard';
import { OrganizationBootCheck } from './services/organization/organization-boot-check';
import ProjectStatsController from './controllers/project-stats.controller';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { UserLoginAttemptsStorage } from './redis/user-login-attempts.storage';
import { CustomThrottlerGuard } from './guards/custom-throttler.guard';
import { SeedDataService } from './seeds/seed-data.service';
import { UserSeed } from './seeds/user.seed';
import { dataSourceOptions } from './connection/datasource';
import { serializeTransactions } from './connection/serialize-transactions';
import { DbType } from './utils/database-type-helper';
import { everPlatformModules } from './ever-platform/modules';
import { OperatorModule } from './operator/operator.module';

/**
 * The web app's index.html for every other GET path. Its catch-all route must be registered after every API route,
 * including those of the optional modules imported below, so it lives in its own module imported last: Nest registers
 * the routes of the root module first, then those of each imported module in import order.
 */
@Module({
  controllers: [IndexController],
})
export class IndexModule {}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: config.secret,
      signOptions: {
        expiresIn: config.authTokenExpires,
      },
    }),
    ThrottlerModule.forRoot([{ ttl: config.throttle.global.ttl, limit: config.throttle.global.limit }]),
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    TypeOrmModule.forRootAsync({
      useFactory: async () => dataSourceOptions(),
      dataSourceFactory: async options => {
        const dataSource = new DataSource(options);
        return options.type === DbType.BETTER_SQLITE3 ? serializeTransactions(dataSource) : dataSource;
      },
    }),
    TypeOrmModule.forFeature([
      User,
      Invite,
      ProjectUser,
      Project,
      Term,
      Locale,
      ProjectLocale,
      Translation,
      TranslationHistory,
      ProjectClient,
      Plan,
      Label,
      UserIdentity,
      EverIdSession,
      EverIdLogoutJti,
      Organization,
      OrganizationUser,
      OrganizationInvite,
    ]),
    HttpModule,
    // Optional Ever Platform modules: the statistics unless TR_EVER_STATS_ENABLED=false, the connection only with
    // TR_EVER_CONNECT_ENABLED=true
    ...everPlatformModules(config.everPlatform),
    // The operator console and organization export and deletion (P6): their routes answer only in SaaS mode
    OperatorModule,
    // Keep last (catch-all GET route)
    IndexModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UserController,
    OrganizationController,
    ProjectController,
    ProjectStatsController,
    ProjectPlanController,
    ProjectUserController,
    ProjectInviteController,
    TermController,
    TranslationController,
    ProjectActivityController,
    ImportController,
    ProjectClientController,
    ProjectLabelController,
    ExportsController,
    LocaleController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // Default deny: every route declares who may call it (@Access), checked before the route's own guards
    {
      provide: APP_GUARD,
      useClass: AccessGuard,
    },
    UserService,
    AuthService,
    MailService,
    JwtStrategy,
    AuthorizationService,
    UserLoginAttemptsStorage,
    SeedDataService,
    UserSeed,
    OidcProviderService,
    EverIdSessionService,
    OrganizationService,
    OrganizationScopedProjects,
    OrganizationBootCheck,
  ],
})
export class AppModule {
  /**
   * Configures middleware for the application, applying the Morgan logging middleware
   * conditionally based on the `accessLogsEnabled` configuration.
   *
   * @param {MiddlewareConsumer} consumer - The `MiddlewareConsumer` instance used to apply middleware to routes.
   * @returns {void} - This function does not return a value.
   */
  configure(consumer: MiddlewareConsumer): void {
    if (config.accessLogsEnabled) {
      MorganMiddleware.configure(SAFE_SHORT_FORMAT);
      consumer.apply(MorganMiddleware).forRoutes('{*splat}');
    }
  }
}

/**
 * Configures global pipes, filters, CORS, static assets, and view settings for the given NestExpress application instance.
 * This setup is used to ensure consistent security, validation, and resource serving behavior across the application.
 *
 * @param {NestExpressApplication} app - The NestJS application instance to apply the configurations to.
 * @returns {void} - This function does not return a value.
 */
export const addPipesAndFilters = (app: NestExpressApplication): void => {
  app.disable('x-powered-by');

  app.set('etag', false);

  // Express 5 (bundled with NestJS 11) changed the default query parser to 'simple',
  // which no longer parses nested objects/arrays. Restore the Express 4 'extended'
  // (qs-based) behavior so existing query-string parsing keeps working.
  app.set('query parser', 'extended');

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

  // Before the static files: a tagged index.html (demo install, Ever app links) must go through IndexController
  app.use(redirectTaggedIndexFile);

  app.useStaticAssets(config.publicDir, { index: false, redirect: false });

  app.setBaseViewsDir('src/templates');

  app.engine('html', renderFile);
};
