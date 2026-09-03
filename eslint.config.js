import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import boundaries from 'eslint-plugin-boundaries'

/** Layer rule from wiki 02_architecture, as a lint rule rather than as prose. */
// One element per layer (folder matching is the default), so
// `src/main/window.ts` belongs to `main`. A trailing `/*` would ask for a
// sub-folder level that does not exist and silently classify everything as
// unknown — which is how this rule dies without anyone noticing.
const elements = [
  { type: 'shared', pattern: 'src/shared' },
  { type: 'core', pattern: 'src/core' },
  { type: 'main', pattern: 'src/main' },
  { type: 'preload', pattern: 'src/preload' },
  { type: 'renderer', pattern: 'src/renderer' },
]

const mayImport = (from, types) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: { anyOf: types } } } },
})

const layerPolicies = [
  // shared is the contract: it depends on nothing first-party.
  mayImport('core', ['core', 'shared']),
  mayImport('main', ['main', 'core', 'shared']),
  mayImport('preload', ['preload', 'shared']),
  mayImport('renderer', ['renderer', 'core', 'shared']),
]

// `src/core` is pure by construction, and `src/renderer` is sandboxed: neither
// may reach the platform. This is what makes core's tests fast and total.
const noPlatform = {
  // Static imports are caught by no-restricted-imports; dynamic `import()` is
  // a separate syntax node and slips straight through it.
  'no-restricted-syntax': [
    'error',
    { selector: 'ClassDeclaration', message: 'Functions, not classes (wiki 06_coding_style rule 1).' },
    { selector: 'TSEnumDeclaration', message: 'Use a union of literals instead of an enum.' },
    {
      selector: "ImportExpression[source.value=/^(node:|electron$|fs$|path$|child_process$)/]",
      message: 'I/O belongs in src/main.',
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: ['node:*', 'electron'],
      paths: [
        { name: 'fs', message: 'I/O belongs in src/main.' },
        { name: 'path', message: 'I/O belongs in src/main.' },
        { name: 'child_process', message: 'I/O belongs in src/main.' },
      ],
    },
  ],
}

const noClasses = {
  'no-restricted-syntax': [
    'error',
    { selector: 'ClassDeclaration', message: 'Functions, not classes (wiki 06_coding_style rule 1).' },
    { selector: 'TSEnumDeclaration', message: 'Use a union of literals instead of an enum.' },
  ],
}

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'coverage/**', 'node_modules/**', 'local_context/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/include': ['src/**'],
      // Without a TS-aware resolver, `.js` specifiers (which verbatimModuleSyntax
      // requires) resolve to nothing and the layer rule silently passes.
      'import/resolver': { typescript: { project: ['tsconfig.node.json', 'tsconfig.web.json'] } },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: layerPolicies }],
      // An import the resolver cannot classify would otherwise slip past the
      // layer rule entirely, which is how architecture lint quietly dies.
      'boundaries/no-unknown-dependencies': 'error',
      ...noClasses,
      'no-console': ['error', { allow: ['warn', 'error'] }],
      complexity: ['error', 8],
      '@typescript-eslint/no-explicit-any': 'error',
      // `_why` labels a table-driven case that the assertion does not read; the
      // underscore convention matches tsconfig's `noUnusedParameters`.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Type aliases everywhere: unions are the workhorse and interfaces
      // invite extension hierarchies (wiki 06_coding_style rules 1 and 5).
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: false }],
    },
  },
  { files: ['src/core/**/*.ts', 'src/renderer/**/*.{ts,tsx}'], rules: noPlatform },
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/explicit-function-return-type': 'off' } },
  {
    files: ['*.config.ts', 'eslint.config.js'],
    languageOptions: { parserOptions: { project: null, projectService: false } },
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
)
