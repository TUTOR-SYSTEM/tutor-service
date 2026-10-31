/**
 * Stand-in for `PrismaService`: every `prisma.<model>.<method>` is a lazily-created `jest.fn()`
 * (resolving `undefined` until the test stubs it), and `$queryRaw` / `$executeRaw` are `jest.fn()`
 * tagged-template handlers. `$transaction` accepts both forms: an array of already-built
 * promises, or a callback that receives the mock itself.
 */
export type PrismaMock = {
  [model: string]: Record<string, jest.Mock>;
} & {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
};

export function createPrismaMock(): PrismaMock {
  const models = new Map<string, Record<string, jest.Mock>>();

  const modelDelegate = (name: string) => {
    let delegate = models.get(name);
    if (!delegate) {
      const methods = new Map<string, jest.Mock>();
      delegate = new Proxy({} as Record<string, jest.Mock>, {
        get: (_target, method: string) => {
          let fn = methods.get(method);
          if (!fn) {
            fn = jest.fn();
            methods.set(method, fn);
          }
          return fn;
        },
      });
      models.set(name, delegate);
    }
    return delegate;
  };

  const root: Record<string, unknown> = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  const proxy = new Proxy(root, {
    get: (target, prop: string) => (prop in target ? target[prop] : modelDelegate(prop)),
  });
  root.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(proxy)
      : Promise.all(arg as unknown[]),
  );
  return proxy as unknown as PrismaMock;
}
