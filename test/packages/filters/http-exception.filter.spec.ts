import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from '@packages/filters/http-exception.filter';

function run(exception: HttpException, url = '/classes') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url }),
      getResponse: () => ({ status }),
    }),
  };

  new HttpExceptionFilter().catch(exception, host as never);

  return { status, body: json.mock.calls[0][0] as { message: unknown; errors?: unknown } };
}

describe('HttpExceptionFilter', () => {
  it('uses the response message when the body has one', () => {
    const { body } = run(new BadRequestException('Bad input'));

    expect(body.message).toBe('Bad input');
  });

  it('falls back to the exception message when the body has no message', () => {
    const exception = new HttpException({ statusCode: 400 }, HttpStatus.BAD_REQUEST);
    exception.message = 'fallback text';

    expect(run(exception).body.message).toBe('fallback text');
  });

  it('uses the status code from the exception', () => {
    const { status } = run(new BadRequestException('Bad input'));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('passes through field-level errors, keeping their structure', () => {
    const errors = [{ path: ['name'], message: 'Required' }];
    const exception = new HttpException({ message: 'Validation failed', errors }, 422);

    const { body } = run(exception);

    expect(body.errors).toEqual(errors);
  });
});
