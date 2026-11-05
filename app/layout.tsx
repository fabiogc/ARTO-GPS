import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'ARTO | Gerenciamento de Obras Hospitalares', template: '%s · ARTO' },
  description: 'Painel de orçamento e contratações — Hospital Caicó',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'ARTO Obras', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f6f5f2',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
