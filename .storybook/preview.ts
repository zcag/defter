import type { Preview } from '@storybook/react'
import '../packages/react/src/styles.css'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
  },
}

export default preview
