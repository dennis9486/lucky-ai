import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const configPath = join(dirname(fileURLToPath(import.meta.url)), 'tailwind.config.js')

export default {
  plugins: [tailwindcss(configPath), autoprefixer()]
}
