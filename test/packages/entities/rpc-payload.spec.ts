import {
  classGetAllPayloadSchema,
  classIdPayloadSchema,
  curriculumGenerateCodePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';

const USER_ID = '6f1c2a3e-4b5d-4e8f-9a0b-1c2d3e4f5a6b';
const CLASS_ID = '7a2d3b4f-5c6e-4f90-8b1c-2d3e4f5a6b7c';

describe('RPC payload schemas (TS-01)', () => {
  it('accepts a well-formed id payload and keeps the identity', () => {
    const parsed = parseRpcPayload(classIdPayloadSchema, {
      userId: USER_ID,
      role: 'TUTOR',
      id: CLASS_ID,
    });
    expect(parsed).toEqual({ userId: USER_ID, role: 'TUTOR', id: CLASS_ID });
  });

  it('drops fields the schema does not declare', () => {
    const parsed = parseRpcPayload(classIdPayloadSchema, {
      userId: USER_ID,
      id: CLASS_ID,
      extra: 'injected',
    });
    expect(parsed).not.toHaveProperty('extra');
  });

  it('rejects a non-uuid id', () => {
    expect(() => parseRpcPayload(classIdPayloadSchema, { userId: USER_ID, id: 'abc' })).toThrow();
  });

  it('rejects a non-uuid userId', () => {
    expect(() =>
      parseRpcPayload(classIdPayloadSchema, { userId: 'admin', id: CLASS_ID }),
    ).toThrow();
  });

  it('fills pagination defaults when the query is omitted (same as the HTTP route)', () => {
    const parsed = parseRpcPayload(classGetAllPayloadSchema, { userId: USER_ID });
    expect(parsed.query).toEqual(expect.objectContaining({ page: 1, limit: 10 }));
  });

  it('accepts generateCode with or without a subject', () => {
    expect(parseRpcPayload(curriculumGenerateCodePayloadSchema, undefined)).toBeUndefined();
    expect(parseRpcPayload(curriculumGenerateCodePayloadSchema, { subject: 'MAT' })).toEqual({
      subject: 'MAT',
    });
  });
});
