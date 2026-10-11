import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { compareData, hashData } from '@packages/helpers/hashingData.helper';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const hashMock = bcrypt.hash as unknown as jest.Mock;
const compareMock = bcrypt.compare as unknown as jest.Mock;

describe('hashData', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hashes with 10 salt rounds and returns the hash', async () => {
    hashMock.mockResolvedValue('$2b$10$hash');

    await expect(hashData('secret')).resolves.toBe('$2b$10$hash');
    expect(hashMock).toHaveBeenCalledWith('secret', 10);
  });

  it('wraps a bcrypt failure in BadRequestException', async () => {
    hashMock.mockRejectedValue(new Error('boom'));

    await expect(hashData('secret')).rejects.toBeInstanceOf(BadRequestException);
    await expect(hashData('secret')).rejects.toThrow('Failed to hash data: Error: boom');
  });
});

describe('compareData', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when the data matches the hash', async () => {
    compareMock.mockResolvedValue(true);

    await expect(compareData('secret', '$2b$10$hash')).resolves.toBe(true);
    expect(compareMock).toHaveBeenCalledWith('secret', '$2b$10$hash');
  });

  it('returns false when the data does not match the hash', async () => {
    compareMock.mockResolvedValue(false);

    await expect(compareData('wrong', '$2b$10$hash')).resolves.toBe(false);
  });

  it('wraps a bcrypt failure in BadRequestException', async () => {
    compareMock.mockRejectedValue(new Error('invalid salt'));

    await expect(compareData('secret', 'not-a-hash')).rejects.toThrow(
      'Failed to verify data: Error: invalid salt',
    );
  });
});
