import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Money is handled in integer minor units; Math.round on a currency
          // float is exactly the bug this codebase must not contain.
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
          message:
            'Money is handled in integer minor units. Use the domain/money helpers rather than Math.round on a currency value.',
        },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // These modules do integer-only arithmetic on values that are already in
    // minor units, or on non-currency quantities (seconds, metres, bps).
    files: [
      'src/domain/money.ts',
      'src/domain/uncertainty.ts',
      'src/domain/ranking.ts',
      'src/domain/reconcile.ts',
      // Fare arithmetic is integer minor units throughout; the Math.round uses
      // here convert seconds to minutes for display labels.
      'src/domain/tariff.ts',
      // Seconds and metres only; every money value here is integer minor units
      // added or multiplied, never rounded.
      'src/domain/bike.ts',
      // The only Math.round here scales the wordmark to the mark's pixel size.
      'src/ui/Brand.tsx',
      // Math.round here turns a position along the day into a colour-mix
      // percentage. The money in this file arrives already in minor units and
      // is only formatted, never arithmetic.
      'src/ui/FareDay.tsx',
      // Math.round here converts milliseconds to minutes for a clock label. The
      // fares themselves come straight out of computeFare in minor units and
      // are only subtracted, never rounded.
      'src/domain/fareclock.ts',
      // Math.round here scales a rate-limit request count, not a currency value.
      'src/app/api/_lib/request.ts',
      'src/domain/freshness.ts',
      'src/location/**',
      'src/sources/**',
      'src/observability/**',
      'src/ui/format.ts',
      // Pixel geometry and layout maths, not currency.
      'src/ui/ProviderMark.tsx',
      'src/ui/RideDetailSheet.tsx',
      'src/ui/useLiveRefresh.ts',
      // Seconds -> minutes for a console report; not currency.
      'scripts/**',
      'src/ui/CompareApp.tsx',
      // Animation frame counts and map geometry, not currency.
      'src/ui/RouteMap.tsx',
      'src/app/admin/page.tsx',
      'tests/**',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export default config;
