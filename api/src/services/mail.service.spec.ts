import { config } from '../config';
import { User } from '../entity/user.entity';
import MailService from './mail.service';

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
