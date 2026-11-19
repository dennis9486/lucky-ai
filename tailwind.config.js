import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{vue,ts,html}'],
  theme: {
    extend: {
      colors: {
        codex: {
          bg: 'var(--codex-bg, #fafafa)',
          sidebar: 'var(--codex-sidebar, #f5f5f5)',
          'sidebar-hover': 'var(--codex-sidebar-hover, #ebebeb)',
          'composer-bar': 'var(--codex-composer-bar, #f7f7f7)',
          'composer-surface': 'var(--codex-composer-surface, #f7f7f7)',
          text: 'var(--codex-text, #1a1a1a)',
          'text-secondary': 'var(--codex-text-secondary, #4a4a4a)',
          muted: 'var(--codex-muted, #8a8a8a)',
          border: 'var(--codex-border, #e5e5e5)',
          'border-hover': 'var(--codex-border-hover, #d4d4d4)',
          hover: 'var(--codex-hover, #f0f0f0)',
          accent: 'var(--codex-accent, #2563eb)',
          'accent-hover': 'var(--codex-accent-hover, #1d4ed8)'
        }
      },
      boxShadow: {
        'codex-composer': '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)',
        'codex-card': '0 1px 2px rgba(0,0,0,0.04)'
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'var(--codex-text)',
            '--tw-prose-headings': 'var(--codex-text)',
            '--tw-prose-lead': 'var(--codex-text-secondary)',
            '--tw-prose-links': 'var(--codex-accent)',
            '--tw-prose-bold': 'var(--codex-text)',
            '--tw-prose-counters': 'var(--codex-muted)',
            '--tw-prose-bullets': 'var(--codex-muted)',
            '--tw-prose-hr': 'var(--codex-border)',
            '--tw-prose-quotes': 'var(--codex-text-secondary)',
            '--tw-prose-quote-borders': 'var(--codex-border)',
            '--tw-prose-captions': 'var(--codex-muted)',
            '--tw-prose-kbd': 'var(--codex-text)',
            '--tw-prose-kbd-shadows': 'color-mix(in srgb, var(--codex-text) 10%, transparent)',
            '--tw-prose-code': 'var(--codex-accent)',
            '--tw-prose-pre-code': 'var(--codex-text)',
            '--tw-prose-pre-bg': '#1f2937',
            '--tw-prose-th-borders': 'var(--codex-border)',
            '--tw-prose-td-borders': 'var(--codex-border)',
            maxWidth: 'none',
            color: 'var(--codex-text)',
            a: {
              color: 'var(--codex-accent)',
              textDecoration: 'underline',
              fontWeight: '500'
            },
            strong: {
              color: 'var(--codex-text)',
              fontWeight: '600'
            },
            thead: {
              borderBottomColor: 'var(--codex-border-hover)'
            },
            'thead th': {
              color: 'var(--codex-text)',
              backgroundColor: 'color-mix(in srgb, var(--codex-text) 7%, var(--codex-bg))'
            },
            'tbody td': {
              color: 'var(--codex-text)'
            },
            'th, td': {
              borderColor: 'var(--codex-border-hover)'
            },
            code: {
              color: 'var(--codex-accent)',
              backgroundColor: 'var(--codex-hover)',
              fontWeight: '400',
              fontSize: '0.875em'
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' }
          }
        }
      }
    }
  },
  plugins: [typography]
}
