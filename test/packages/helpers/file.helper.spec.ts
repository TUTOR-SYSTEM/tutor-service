import { decodeMulterFilename } from 'src/packages/helpers/file.helper';

describe('decodeMulterFilename', () => {
  it('recovers UTF-8 Vietnamese names that multer decoded as latin1', () => {
    const mojibake = Buffer.from('Bài giảng.pdf', 'utf8').toString('latin1');

    expect(decodeMulterFilename(mojibake)).toBe('Bài giảng.pdf');
  });

  it('leaves pure ASCII names unchanged', () => {
    expect(decodeMulterFilename('lesson-01_final.pdf')).toBe('lesson-01_final.pdf');
  });

  it('round-trips an empty name', () => {
    expect(decodeMulterFilename('')).toBe('');
  });
});
