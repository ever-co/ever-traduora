import { Injectable } from '@nestjs/common';
import { createTransport, SendMailOptions, Transporter } from 'nodemailer';
import { config } from '../config';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { Invite } from '../entity/invite.entity';
import * as Handlebars from 'handlebars';
import { join } from 'path';
import { fstat, readFileSync } from 'fs';
import * as previewEmail from 'preview-email';

@Injectable()
export default class MailService {
  private readonly from: string;
  private readonly transporter: Transporter;

  private readonly knownTemplates = {
    welcome: this.mustCompileTemplate('welcome.txt'),
    passwordChanged: this.mustCompileTemplate('password-changed.txt'),
    passwordResetToken: this.mustCompileTemplate('password-reset-token.txt'),
    invitedToProject: this.mustCompileTemplate('invited-to-project.txt'),
    invitedToPlatform: this.mustCompileTemplate('invited-to-platform.txt'),
  };

  constructor() {
    const options = {
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: {
        user: config.mail.auth.user,
        pass: config.mail.auth.pass,
      },
      tls: {
        // do not fail on invalid certs
        rejectUnauthorized: config.mail.rejectSelfSigned,
      },
    };
    this.transporter = options.host ? createTransport(options) : undefined;
    if (!this.transporter && !(config.env === 'e2e')) {
      console.log(
        'No email transport configured. ' +
          'Please check the documentation on how to configure ' +
          'the mail service at: https://docs.traduora.co/docs/configuration',
      );
    }
    this.from = config.mail.sender;
  }

  async welcomeNewUser(user: User) {
    await this.send({
      from: this.from,
      to: user.email,
      subject: 'Welcome to Traduora - enjoy the beta',
      text: this.knownTemplates.welcome({
        user: user,
        virtualHost: config.virtualHost,
      }),
    });
  }

  async passwordChanged(user: User): Promise<any> {
    await this.send({
      to: user.email,
      from: this.from,
      subject: 'Your password has been changed.',
      text: this.knownTemplates.passwordChanged({
        user: user,
      }),
    });
  }

  async passwordResetToken(user: User, token: string): Promise<any> {
    const endpoint = join(config.virtualHost, 'reset-password');
    await this.send({
      to: user.email,
      from: this.from,
      subject: 'Your password reset token is here.',
      text: this.knownTemplates.passwordResetToken({
        user: user,
        endpoint: endpoint,
        resetToken: token,
      }),
    });
  }

  async invitedToProject(user: ProjectUser) {
    await this.send({
      from: this.from,
      to: user.user.email,
      subject: 'You have been granted access to a project on Traduora',
      text: this.knownTemplates.invitedToProject({
        user: user,
        virtualHost: config.virtualHost,
      }),
    });
  }

  async invitedToPlatform(invite: Invite) {
    await this.send({
      from: this.from,
      to: invite.email,
      subject: 'You have been invited to a project on Traduora',
      text: this.knownTemplates.invitedToPlatform({
        invite: invite,
        virtualHost: config.virtualHost,
      }),
    });
  }

  private async send(message: SendMailOptions): Promise<any> {
    if (this.transporter) {
      await this.transporter.sendMail(message);
    }
    if (config.mail.debug) {
      // createTransport({jsonTransport: true})
      await previewEmail(message);
    }
  }

  private mustCompileTemplate(name: string): Handlebars.TemplateDelegate<any> {
    const contents = readFileSync(join(config.templatesDir, 'mail', name)).toString('utf-8');
    return Handlebars.compile(contents);
  }
}
