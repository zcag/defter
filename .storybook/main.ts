import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../packages/react/src/**/*.stories.tsx'],
  addons: [],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: (config) => {
    // Served at defter.cagdas.io/storybook/ in production.
    if (config.command === 'build') config.base = '/storybook/'
    return config
  },
}

export default config
