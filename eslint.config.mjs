// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'node_modules/**',
      'prisma/**',
      'coverage/**',
      '*.config.js',
      '*.config.cjs',
      '**/*.test.ts',
      'src/packages/interfaces/**',
      'test/packages/interfaces/**',
      // Claude Code hook scripts live under .claude/ and are plain Node ESM, not part of the
      // TypeScript project (tsconfig only includes src/**). Exclude them from type-aware linting
      // so the project service does not fail to resolve them.
      '.claude/**',
      // Seed/CLI scripts run directly via `bun scripts/*.ts` and are outside rootDir (src/),
      // so tsconfig can't include them without breaking rootDir. Same rationale as .claude/** above.
      'scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Không báo lỗi Prettier (gồm CRLF/LF) trong ESLint — vẫn có thể chạy `npm run format` khi cần
      'prettier/prettier': 'off',
    },
  },
  // ioredis / nodemailer + bcrypt + @nestjs/jwt: một số môi trường IDE/projectService báo "type could not be resolved" → no-unsafe-* nhiễu; vẫn kiểm tra bằng tsc
  {
    files: [
      'src/redis/redis.service.ts',
      'src/mailer/mailer.service.ts',
      'src/packages/strategy/jwt-user.strategy.ts',
      'src/features/auth/auth.service.ts',
      'src/features/student/student.repository.ts',
      'src/features/curriculum/chapter.repository.ts',
      'src/features/curriculum/chapter.service.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
