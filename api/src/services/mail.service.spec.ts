import { config } from '../config';
import { Invite } from '../entity/invite.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { User } from '../entity/user.entity';
import MailService from './mail.service';
import * as previewEmail from 'preview-email';

// Opening a real preview would write a file and start a browser
jest.mock('preview-email', () => jest.fn().mockResolvedValue(undefined));

describe('MailService.passwordResetToken', () => {
  const resetEmailText = async (email: string, token: string): Promise<string> => {
    // The service logs that no mail transport is configured
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = new MailService();
    const send = jest.spyOn(service as any, 'send').mockResolvedValue(undefined);

    await service.passwordResetToken({ name: 'Jane', email } as User, token);

    expect(send).toHaveBeenCalledTimes(1);
    return (send.mock.calls[0][0] as { text: string }).text;
  };

  afterEach(() => jest.restoreAllMocks());

  it('emails a reset link with the host intact and the email encoded', async () => {
    const text = await resetEmailText('jane+tr@example.com', 'abc');

    expect(text).toContain(`${config.virtualHost}/reset-password?email=jane%2Btr%40example.com&resetToken=abc`);
    expect(text).not.toMatch(/https?:\/[^/]/);
  });

  it('does not HTML-escape the link', async () => {
    const text = await resetEmailText("o'neil@example.com", 'abc');

    expect(text).toContain(`${config.virtualHost}/reset-password?email=o'neil%40example.com&resetToken=abc`);
    expect(text).not.toContain('&#x27;');
  });
});

describe('MailService plain-text emails', () => {
  const name = "Jane O'Neil & Co";
  const email = "o'neil@example.com";
  const projectName = 'R&D <web>';
  const user = { id: 'user-1', name, email } as User;
  const project = { id: 'project-1', name: projectName } as Project;
  const link = `${config.virtualHost}/link?email=o'neil%40example.com&token=abc`;

  const emailText = async (sendEmail: (service: MailService) => Promise<unknown>): Promise<string> => {
    // The service logs that no mail transport is configured
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = new MailService();
    const send = jest.spyOn(service as any, 'send').mockResolvedValue(undefined);

    await sendEmail(service);

    expect(send).toHaveBeenCalledTimes(1);
    return (send.mock.calls[0][0] as { text: string }).text;
  };

  const expectNoHtmlEntities = (text: string) => {
    expect(text).not.toContain('&#x27;');
    expect(text).not.toContain('&amp;');
    expect(text).not.toContain('&lt;');
  };

  afterEach(() => jest.restoreAllMocks());

  it('welcomeNewUser shows the name as typed and keeps the link', async () => {
    const text = await emailText(service => service.welcomeNewUser(user, link));

    expect(text).toContain(`Hi ${name},`);
    expect(text).toContain(link);
    expectNoHtmlEntities(text);
  });

  it('passwordChanged shows the name as typed', async () => {
    const text = await emailText(service => service.passwordChanged(user));

    expect(text).toContain(`Hi ${name},`);
    expectNoHtmlEntities(text);
  });

  it('passwordResetToken shows the name as typed', async () => {
    const text = await emailText(service => service.passwordResetToken(user, 'abc'));

    expect(text).toContain(`Hi ${name},`);
    expect(text).toContain(`${config.virtualHost}/reset-password?email=o'neil%40example.com&resetToken=abc`);
    expectNoHtmlEntities(text);
  });

  it('verifyEmail carries no name (the address may be one someone typed for another person), only the email as typed and the link', async () => {
    const text = await emailText(service => service.verifyEmail(user, link));

    expect(text).not.toContain(name);
    expect(text.startsWith('Hello,')).toBe(true);
    expect(text).toContain(`confirm that ${email} is your email address`);
    expect(text).toContain(link);
    expectNoHtmlEntities(text);
  });

  it('invitedToProject shows the name and project name as typed', async () => {
    const projectUser = { user, project, role: ProjectRole.Editor } as ProjectUser;

    const text = await emailText(service => service.invitedToProject(projectUser));

    expect(text).toContain(`Hi ${name},`);
    expect(text).toContain(`the project '${projectName}' on Traduora with the role 'editor'`);
    expect(text).toContain(`${config.virtualHost}/projects/project-1 `);
    expectNoHtmlEntities(text);
  });

  it('invitedToPlatform shows the email and project name as typed and keeps the link', async () => {
    const invite = { email, project, role: ProjectRole.Viewer } as Invite;

    const text = await emailText(service => service.invitedToPlatform(invite, link));

    expect(text).toContain(`Hi ${email},`);
    expect(text).toContain(`join '${projectName}' on Traduora with the role 'viewer'`);
    expect(text).toContain(`The link only works for ${email}.`);
    expect(text).toContain(link);
    expectNoHtmlEntities(text);
  });
});

describe('MailService debug preview', () => {
  const preview = previewEmail as unknown as jest.Mock;
  const debug = config.mail.debug;

  beforeEach(() => preview.mockClear());
  afterEach(() => {
    config.mail.debug = debug;
    jest.restoreAllMocks();
  });

  it('escapes the plain text for the HTML preview only, and sends it as typed', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    config.mail.debug = true;
    const service = new MailService();
    const sendMail = jest.fn().mockResolvedValue(undefined);
    (service as any).transporter = { sendMail };
    const user = { id: 'user-1', name: "Jane O'Neil & Co", email: "o'neil@example.com" } as User;
    const project = { id: 'project-1', name: 'R&D <web>' } as Project;

    await service.invitedToProject({ user, project, role: ProjectRole.Editor } as ProjectUser);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].text).toContain("Hi Jane O'Neil & Co,");
    expect(sendMail.mock.calls[0][0].text).toContain("the project 'R&D <web>' on Traduora");
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0].text).toContain("Hi Jane O'Neil &amp; Co,");
    expect(preview.mock.calls[0][0].text).toContain("the project 'R&amp;D &lt;web&gt;' on Traduora");
    expect(preview.mock.calls[0][0].to).toBe("o'neil@example.com");
  });
});
